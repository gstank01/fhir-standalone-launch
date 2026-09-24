const crypto = require('crypto');
const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const { neon } = require('@neondatabase/serverless');

// 🐛 FIX: this used to be loaded at runtime via fs.readFileSync() from a path
// built out of process.cwd(). Vercel decides which files to bundle into a
// deployed serverless function by statically scanning for require()/import
// calls; it can't see through a dynamically-constructed fs path, so
// FHIRHelpers.json never made it into the deployed bundle and
// process.cwd() (== /var/task at runtime) never had it either, hence the
// ENOENT. A static, relative require() is something the bundler *can* see,
// so it packages this JSON file alongside the function automatically.
// FHIRHelpers stays a static file — it's the standard FHIR R4 data-type
// conversion library shared by every CQL rule, not rule-specific logic.
const fhirHelpersJson = require('./FHIRHelpers.json');

const DEFAULT_RULE_NAME = 'ReferralTriageLogic';

// --- Global Token Cache Strategy ---
let tokenCache = { access_token: null, expiresAt: 0 };

// Rules themselves now live in the cql_rules table (sql/002_create_cql_rules.sql)
// instead of a compiled logic.json baked into the deployment — so adding or
// changing a rule is a database write (POST /api/rules), not a redeploy.
// Not caching the row in memory: the whole point is that a rule edit takes
// effect on the next request, and this is a single lightweight JSONB read.
async function getRuleFromDb(ruleName) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured; cannot load CQL rules from cql_rules.');
  }

  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`SELECT * FROM cql_rules WHERE name = ${ruleName} AND active = true LIMIT 1`;

  if (rows.length === 0) {
    throw new Error(`No active CQL rule named "${ruleName}" found in cql_rules. Add it via POST /api/rules.`);
  }

  const rule = rows[0];
  // Defensive: JSONB normally comes back already parsed, but don't assume it.
  if (typeof rule.elm_json === 'string') {
    rule.elm_json = JSON.parse(rule.elm_json);
  }
  return rule;
}

async function getLibrary(ruleName) {
  const rule = await getRuleFromDb(ruleName);
  const repository = new cql.Repository({ FHIRHelpers: fhirHelpersJson });
  const library = new cql.Library(rule.elm_json, repository);
  return { library, rule };
}

function buildPristineBundle(bundles) {
  const allEntries = [];
  // 🐛 FIX: the Patient search result and the Encounter search's
  // `_include=Encounter:patient` both legitimately return the same Patient
  // resource — so without de-duping, the merged bundle ends up with two
  // Patient entries. cql-execution's implicit `context Patient` binding is
  // `SingletonFrom([Patient])`, which throws "requires a 0 or 1 arg array"
  // the moment there's more than one. De-dupe by resourceType/id so each
  // resource — Patient included — appears in the merged bundle exactly once.
  const seenKeys = new Set();
  let duplicatesDropped = 0;

  bundles.forEach(bundle => {
    if (!bundle || !bundle.entry) return;
    bundle.entry.forEach(entry => {
      if (!entry.resource) return;
      if (!entry.fullUrl) {
        entry.fullUrl = `${entry.resource.resourceType}/${entry.resource.id}`;
      }

      const key = `${entry.resource.resourceType}/${entry.resource.id}`;
      if (seenKeys.has(key)) {
        duplicatesDropped++;
        return;
      }
      seenKeys.add(key);

      allEntries.push(entry);
    });
  });

  if (duplicatesDropped > 0) {
    console.log(`[BUNDLE] Dropped ${duplicatesDropped} duplicate resource(s) found across the merged bundles.`);
  }

  const hasPatient = allEntries.some(e => e.resource.resourceType === 'Patient');
  if (!hasPatient) {
    const foundTypes = [...new Set(allEntries.map(e => e.resource.resourceType))].join(', ');
    throw new Error(`Merged bundle has no Patient resource. Resource types present: [${foundTypes}]`);
  }

  return { resourceType: 'Bundle', type: 'collection', entry: allEntries };
}

async function runCqlRule(pristineBundle, ruleName) {
  // 🐛 FIX: getLibrary() and executor.exec() are both async — this function was
  // previously calling neither with `await`, so the Executor was constructed with
  // a pending Promise instead of the actual compiled Library (making every
  // `library.expressions` lookup silently iterate over nothing), and `results`
  // held a pending Promise instead of a Results object (so `results.patientResults`
  // was undefined and Object.keys() on the Promise itself returned []). That is
  // exactly the "Engine executed but produced no patient results" symptom: the
  // patient loaded fine (that lookup is synchronous), but the CQL rules never
  // actually ran against it.
  const { library, rule } = await getLibrary(ruleName);
  const executor = new cql.Executor(library);
  const patientSource = cqlfhir.PatientSource.FHIRv400();

  patientSource.loadBundles([pristineBundle]);

  const loadedPatient = patientSource.currentPatient();
  const loadedPatientId = loadedPatient ? loadedPatient.getId() : null;
  console.log(`[CQL] Rule "${ruleName}" (v${rule.version}) loaded with ${Object.keys(library.expressions || {}).length} expression(s). Loaded patient id: ${loadedPatientId}`);

  // ✅ Execute engine matching BEFORE resetting the data collection iterator
  const results = await executor.exec(patientSource);
  patientSource.reset();

  const rawResultsContainer = results?.patientResults || {};
  const availablePatientKeys = Object.keys(rawResultsContainer);
  console.log(`[CQL] Execution complete. Patient result keys: [${availablePatientKeys.join(', ')}]`);

  return { loadedPatientId, availablePatientKeys, rawResultsContainer, rule };
}

async function getAccessToken({ clientID, audienceUrl, privateKeyText }) {
  const now = Math.floor(Date.now() / 1000);

  // ✅ Retrieve valid cached token (configured with a 15-second expiration margin)
  if (tokenCache.access_token && tokenCache.expiresAt > now + 15) {
    return tokenCache.access_token;
  }

  const header = { alg: 'RS512', typ: 'JWT', kid: process.env.KEY_ID || 'myapp-key-3' };
  const payload = {
    iss: clientID,
    sub: clientID,
    aud: audienceUrl,
    exp: now + 300,
    jti: crypto.randomUUID().toUpperCase()
  };

  const base64UrlEncode = input =>
    Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign('RSA-SHA512');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(privateKeyText, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const clientAssertion = `${signingInput}.${signature}`;

  const tokenRequestBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion
  });

  const tokenResponse = await fetch(audienceUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenRequestBody.toString()
  });
  
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
  }

  // Populate token memory data structure (defaulting to a 300-second window if missing)
  tokenCache = {
    access_token: tokenData.access_token,
    expiresAt: now + (tokenData.expires_in || 300)
  };

  return tokenCache.access_token;
}

// Walks the CQL engine's intermediate named-expression results (which are
// already computed for us — every define in triage-logic.cql runs in
// `context Patient`, so cql-execution returns all of them, not just the
// final boolean) and logs/returns a human-readable trace of exactly why
// "Is Valid Referral Triage Process" landed on true or false: how many
// Referral Triage Encounters and Active Episodes of Care were found, and
// whether any encounter's episodeOfCare reference actually matched one of
// the active episodes.
function traceReferralTriageEvaluation(patientResults) {
  const trace = [];
  const record = (step, message) => {
    console.log(`[CQL STEP ${step}] ${message}`);
    trace.push({ step, message });
  };

  const referralEncounters = patientResults['Referral Triage Encounters'] || [];
  const activeEpisodes = patientResults['Active Episodes of Care'] || [];

  record(1, `Found ${referralEncounters.length} "Referral Triage Encounters" (Encounter.type matches the HospitalCodes/2611 code).`);
  if (referralEncounters.length === 0) {
    record(1, 'No matching encounters -> "Is Valid Referral Triage Process" cannot be true.');
  } else {
    referralEncounters.forEach((enc, i) => {
      const episodeRefs = (enc.episodeOfCare || []).map(eoc => eoc?.reference?.value).filter(Boolean);
      record(1, `  Encounter #${i + 1} (id=${enc.id?.value}): episodeOfCare references = [${episodeRefs.join(', ') || 'none'}]`);
    });
  }

  record(2, `Found ${activeEpisodes.length} "Active Episodes of Care" (EpisodeOfCare.status = 'active').`);
  if (activeEpisodes.length === 0) {
    record(2, 'No active episodes -> "Is Valid Referral Triage Process" cannot be true.');
  } else {
    activeEpisodes.forEach((ep, i) => {
      record(2, `  Episode #${i + 1}: id=${ep.id?.value}, status=${ep.status?.value}`);
    });
  }

  record(3, 'Checking every Referral Triage Encounter against every Active Episode of Care for a matching reference...');
  let matchFound = false;
  referralEncounters.forEach((enc, i) => {
    const episodeRefs = (enc.episodeOfCare || []).map(eoc => eoc?.reference?.value).filter(Boolean);
    activeEpisodes.forEach((ep, j) => {
      const expectedRef = `EpisodeOfCare/${ep.id?.value}`;
      const isMatch = episodeRefs.includes(expectedRef);
      record(3, `  Encounter #${i + 1} vs Active Episode #${j + 1} (expected "${expectedRef}"): ${isMatch ? 'MATCH ✅' : 'no match'}`);
      if (isMatch) matchFound = true;
    });
  });
  if (referralEncounters.length === 0 || activeEpisodes.length === 0) {
    record(3, '  (skipped — nothing to compare, see steps 1/2 above)');
  }

  record(4, `Final result -> "Is Valid Referral Triage Process" = ${patientResults['Is Valid Referral Triage Process']} (matchFound=${matchFound})`);

  return trace;
}

// Fallback tracer for any rule other than ReferralTriageLogic: we don't know
// that rule's internal structure, so just log every intermediate named
// expression the engine computed (array length, or the value itself for
// scalars) plus the final result expression. Still far more useful for
// debugging than only seeing the final boolean.
function traceGenericRuleEvaluation(patientResults, resultExpression) {
  const trace = [];
  const record = (step, message) => {
    console.log(`[CQL STEP ${step}] ${message}`);
    trace.push({ step, message });
  };

  let step = 1;
  Object.keys(patientResults).forEach(key => {
    if (key === resultExpression) return;
    const value = patientResults[key];
    const summary = Array.isArray(value) ? `list of ${value.length}` : JSON.stringify(value);
    record(step++, `"${key}" = ${summary}`);
  });

  record(step, `Final result -> "${resultExpression}" = ${patientResults[resultExpression]}`);

  return trace;
}

// Walks the intermediate results for AppointmentLocationLogic the same way
// traceReferralTriageEvaluation does for its rule: how many Locations are
// part of the RPY01 site, how many Appointments were found in total, and
// whether any appointment's participant actually pointed at one of those
// matched locations.
function traceAppointmentLocationEvaluation(patientResults) {
  const trace = [];
  const record = (step, message) => {
    console.log(`[CQL STEP ${step}] ${message}`);
    trace.push({ step, message });
  };

  const targetLocations = patientResults['Royal Marsden Chelsea Locations'] || [];
  const matchingAppointments = patientResults['Appointments At Target Location'] || [];
  const site = SITE_LOCATION_CODES.RPY01;

  record(1, `Found ${targetLocations.length} Location resource(s) whose partOf references Location/${site.locationId} (site code "RPY01", ${site.displayName}).`);
  if (targetLocations.length === 0) {
    record(1, 'No matching locations -> "Is Royal Marsden Chelsea Appointment" cannot be true.');
  } else {
    targetLocations.forEach((loc, i) => {
      record(1, `  Location #${i + 1}: id=${loc.id?.value}`);
    });
  }

  record(2, `Found ${matchingAppointments.length} Appointment(s) with a participant referencing one of those location(s).`);
  matchingAppointments.forEach((appt, i) => {
    record(2, `  Appointment #${i + 1} (id=${appt.id?.value}, status=${appt.status?.value})`);
  });

  record(3, `Final result -> "Is Royal Marsden Chelsea Appointment" = ${patientResults['Is Royal Marsden Chelsea Appointment']}`);

  return trace;
}

// Epic never sends a short site code like "RPY01" in the FHIR bundle —
// only an internal Location id, which shows up as the *parent* Location
// referenced by the appointment's Location's own .partOf (e.g.
// { "reference": "Location/eLVUrSrT4-KVXjmLgWvTBDg3",
//   "display": "The Royal Marsden - Chelsea" }). This is the same manual
// code -> id mapping the rule's ELM (sql/006_seed_appointment_location_rule.sql)
// is compiled against, kept here too for the human-readable trace/queue
// text. Four more sites will be added here later; for now only RPY01 is
// evaluated (see AppointmentLocationLogic's "Royal Marsden Chelsea
// Locations" define).
const SITE_LOCATION_CODES = {
  RPY01: {
    locationId: 'eLVUrSrT4-KVXjmLgWvTBDg3',
    displayName: 'The Royal Marsden - Chelsea'
  }
};

function extractPatientDisplayName(patientResource) {
  const name = (patientResource.name || []).find(n => n.text || n.family || (n.given && n.given.length)) || {};
  if (name.text) return name.text;
  const parts = [...(name.given || []), name.family].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Unknown';
}

const EPISODE_NAME_EXTENSION_URL = 'http://open.epic.com/FHIR/StructureDefinition/extension/episode-name';

// Pulls the human-readable episode name (e.g. "RMH 62 Day Cancer Suspected")
// off the active EpisodeOfCare's Epic extension, straight from the raw
// encounter bundle (not the CQL-wrapped results) since that's the simplest
// place to read a plain extension value. Joins multiple if more than one
// active episode carries the extension; returns null if none do.
function extractEpisodeName(encounterBundle) {
  if (!encounterBundle || !encounterBundle.entry) return null;

  const names = encounterBundle.entry
    .filter(e => e.resource && e.resource.resourceType === 'EpisodeOfCare' && e.resource.status === 'active')
    .flatMap(e => (e.resource.extension || [])
      .filter(ext => ext.url === EPISODE_NAME_EXTENSION_URL)
      .map(ext => ext.valueString)
    )
    .filter(Boolean);

  return names.length ? names.join('; ') : null;
}

// AppointmentLocationLogic queues one row PER MATCHING APPOINTMENT (not one
// per patient) so each visit's own location shows up in the queue. Walks
// the raw appointment bundle directly (not the CQL-wrapped patientResults)
// re-deriving the exact same match the ELM's "Royal Marsden Chelsea
// Locations" / "Appointments At Target Location" defines compute — partOf
// pointing at the target site, then a participant pointing at one of
// those locations — because the raw bundle is the simplest place to read
// plain field values, same reasoning as extractEpisodeName() above.
function extractMatchingAppointmentLocations(appointmentBundle) {
  if (!appointmentBundle || !appointmentBundle.entry) return [];

  const targetSiteRef = `Location/${SITE_LOCATION_CODES.RPY01.locationId}`;

  const locationsById = {};
  appointmentBundle.entry
    .filter(e => e.resource && e.resource.resourceType === 'Location')
    .forEach(e => { locationsById[e.resource.id] = e.resource; });

  const targetLocationRefs = new Set(
    Object.values(locationsById)
      .filter(loc => loc.partOf && loc.partOf.reference === targetSiteRef)
      .map(loc => `Location/${loc.id}`)
  );

  const matches = [];
  appointmentBundle.entry
    .filter(e => e.resource && e.resource.resourceType === 'Appointment')
    .forEach(e => {
      const appt = e.resource;
      const matchedParticipant = (appt.participant || []).find(
        p => p.actor && targetLocationRefs.has(p.actor.reference)
      );
      if (!matchedParticipant) return;

      const location = locationsById[matchedParticipant.actor.reference.split('/')[1]];
      matches.push({
        appointmentId: appt.id,
        appointmentStart: appt.start || null,
        locationName: (location && (location.name || (location.partOf && location.partOf.display))) || SITE_LOCATION_CODES.RPY01.displayName,
        // Full raw resources, kept alongside the summary fields above so
        // buildMatchedBundle() can assemble a real FHIR Bundle out of
        // exactly what matched, without re-scanning the bundle.
        apptResource: appt,
        locationResource: location || null
      });
    });

  return matches;
}

// v2: same matching criteria as ReferralTriageLogic v1.0.0 (see
// triage-logic.cql / sql/004_seed_referral_triage_rule.sql, unchanged) —
// this just re-derives, from the raw bundle, which specific Encounter(s)
// and EpisodeOfCare(s) actually satisfied the rule, so buildMatchedBundle()
// can package exactly those resources instead of the whole fetched bundle.
const HOSPITAL_CODE_SYSTEM = 'urn:oid:1.2.840.114350.1.13.520.3.7.10.698084.30';
const REFERRAL_TRIAGE_CODE = '2611';

function extractMatchingEncountersAndEpisodes(encounterBundle) {
  if (!encounterBundle || !encounterBundle.entry) return { encounters: [], episodes: [] };

  const allEncounters = encounterBundle.entry
    .filter(e => e.resource && e.resource.resourceType === 'Encounter')
    .map(e => e.resource);
  const allEpisodes = encounterBundle.entry
    .filter(e => e.resource && e.resource.resourceType === 'EpisodeOfCare')
    .map(e => e.resource);

  const activeEpisodes = allEpisodes.filter(ep => ep.status === 'active');
  const activeEpisodeRefs = new Set(activeEpisodes.map(ep => `EpisodeOfCare/${ep.id}`));

  const referralEncounters = allEncounters.filter(enc =>
    (enc.type || []).some(t => (t.coding || []).some(c => c.system === HOSPITAL_CODE_SYSTEM && c.code === REFERRAL_TRIAGE_CODE))
  );

  const matchedEncounters = referralEncounters.filter(enc =>
    (enc.episodeOfCare || []).some(eoc => activeEpisodeRefs.has(eoc.reference))
  );

  const matchedEpisodeRefs = new Set(
    matchedEncounters.flatMap(enc => (enc.episodeOfCare || []).map(eoc => eoc.reference))
  );
  const matchedEpisodes = activeEpisodes.filter(ep => matchedEpisodeRefs.has(`EpisodeOfCare/${ep.id}`));

  return { encounters: matchedEncounters, episodes: matchedEpisodes };
}

// Packages the Patient plus whatever matched resources a rule identifies
// into a real FHIR Bundle (de-duped by resourceType/id, same rule
// buildPristineBundle() already uses) — this is what api/evaluateCql.js's
// v2 rules return as `matchedBundle` alongside the boolean result.
function buildMatchedBundle(patientResource, resources) {
  const seen = new Set();
  const entries = [];

  const addResource = r => {
    if (!r) return;
    const key = `${r.resourceType}/${r.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ fullUrl: key, resource: r });
  };

  addResource(patientResource);
  resources.forEach(addResource);

  return { resourceType: 'Bundle', type: 'collection', entry: entries };
}

// Inserts (or refreshes) a row in the referral_queue table for a patient the
// CQL engine has flagged. Failing to persist should never fail the overall
// evaluation response — the caller still needs to see the CQL result.
// appointmentId defaults to '' for rules (like ReferralTriageLogic) that
// aren't about a specific appointment — the referral_queue unique
// constraint is on (patient_id, appointment_id), so that still collapses
// to at most one row per patient for those rules, same as before, while
// AppointmentLocationLogic gets one row per distinct appointment.
async function addToReferralQueue(queueItem) {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not configured; skipping referral_queue persistence.');
    return false;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO referral_queue (patient_id, identifier, name, dob, status, details, rule_name, episode_name, appointment_id, location_name)
      VALUES (
        ${queueItem.patientId}, ${queueItem.identifier}, ${queueItem.name}, ${queueItem.dob},
        ${queueItem.status}, ${queueItem.details}, ${queueItem.ruleName}, ${queueItem.episodeName},
        ${queueItem.appointmentId || ''}, ${queueItem.locationName || null}
      )
      ON CONFLICT (patient_id, appointment_id) DO UPDATE SET
        identifier = EXCLUDED.identifier,
        name = EXCLUDED.name,
        dob = EXCLUDED.dob,
        status = EXCLUDED.status,
        details = EXCLUDED.details,
        rule_name = EXCLUDED.rule_name,
        episode_name = EXCLUDED.episode_name,
        location_name = EXCLUDED.location_name,
        updated_at = now()
    `;
    return true;
  } catch (error) {
    console.error('Neon DB Error while writing referral_queue:', error);
    return false;
  }
}

async function fhirGet(url, accessToken) {
  console.log(`[FHIR REQUEST] GET ${url}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const body = await response.json();

  // Log every response the FHIR server returns (status + a lightweight
  // summary — the full body can be large, so log resourceType/entry count
  // rather than dumping the whole bundle).
  const entryCount = Array.isArray(body?.entry) ? body.entry.length : null;
  console.log(`[FHIR RESPONSE] ${response.status} ${url} -> resourceType=${body?.resourceType}, entries=${entryCount}`);

  if (!response.ok) {
    console.error(`[FHIR RESPONSE BODY] ${url}:`, JSON.stringify(body));
    throw new Error(`FHIR request failed (${url}): ${JSON.stringify(body)}`);
  }
  return body;
}

// The two rules look at entirely different FHIR resource types, and the
// user toggles between them in the worklist dropdown — so only the
// selected rule's query should ever go out, never both. Each fetcher
// returns just the bundle(s) its rule needs; buildPristineBundle() already
// skips over an undefined bundle, so the caller doesn't need to fill in a
// placeholder for the one that wasn't fetched.
const RESOURCE_FETCHERS = {
  ReferralTriageLogic: async (fhirUrl, fhirId, accessToken) => {
    // ✅ FIX: Migrated 'patient=' filter mapping to 'subject=' to adhere to strict FHIR R4 engine specifications
    const encounterBundle = await fhirGet(
      `${fhirUrl}/Encounter?subject=${fhirId}` +
        `&_include=Encounter:patient` +
        `&_include=Encounter:episode-of-care`,
      accessToken
    );
    return { encounterBundle };
  },
  AppointmentLocationLogic: async (fhirUrl, fhirId, accessToken) => {
    const appointmentBundle = await fhirGet(
      `${fhirUrl}/Appointment?patient=${fhirId}` +
        `&_include=Appointment:location`,
      accessToken
    );
    return { appointmentBundle };
  }
};

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  try {
    const { identifier, ruleName = DEFAULT_RULE_NAME } = req.body || {};
    if (!identifier) {
      return res.status(400).json({ error: 'Missing identifier.' });
    }

    const clientID = process.env.CLIENTID;
    const audienceUrl = process.env.AUDIENCEURL;
    let privateKeyText = process.env.BACKEND_APP_KEY;
    const fhirUrl = process.env.FHIRURL;

    if (!privateKeyText || !clientID || !audienceUrl || !fhirUrl) {
      throw new Error('Missing required environment variables (CLIENTID, AUDIENCEURL, BACKEND_APP_KEY, FHIRURL).');
    }
    privateKeyText = privateKeyText.replace(/\\n/g, '\n');

    console.log(`--- CQL WORKFLOW: identifier=${identifier}, rule=${ruleName} ---`);

    const accessToken = await getAccessToken({ clientID, audienceUrl, privateKeyText });
    console.log(`[AUTH] Access token acquired (cached until ~${new Date(tokenCache.expiresAt * 1000).toISOString()}).`);

    const patientBundle = await fhirGet(
      `${fhirUrl}/Patient?identifier=${encodeURIComponent(identifier)}`,
      accessToken
    );
    if (!patientBundle.entry || patientBundle.entry.length === 0) {
      const notFoundPayload = {
        success: false,
        error: `No FHIR Patient found for identifier: ${identifier}`,
        patientBundle
      };
      console.log(`[RESPONSE] 404`, JSON.stringify({ ...notFoundPayload, patientBundle: '(omitted from log — see [FHIR RESPONSE] above)' }));
      return res.status(404).json(notFoundPayload);
    }
    const fhirId = patientBundle.entry[0].resource.id;

    // Which FHIR resources to pull next depends on which rule was picked —
    // the two rules look at completely different resource types, and we
    // only ever want to run the one query that rule actually needs, never
    // both. RESOURCE_FETCHERS (defined above) maps ruleName -> the fetch
    // for that rule; unrecognized rule names fall back to the default
    // rule's fetch.
    const fetchResources = RESOURCE_FETCHERS[ruleName] || RESOURCE_FETCHERS[DEFAULT_RULE_NAME];
    const { encounterBundle, appointmentBundle } = await fetchResources(fhirUrl, fhirId, accessToken);

    const pristineBundle = buildPristineBundle([patientBundle, encounterBundle, appointmentBundle]);
    const resourceTypeCounts = pristineBundle.entry.reduce((counts, e) => {
      const type = e.resource.resourceType;
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    console.log(`[BUNDLE] Merged bundle has ${pristineBundle.entry.length} entries:`, JSON.stringify(resourceTypeCounts));

    // 🐛 FIX: this was called without `await` even though it's async — see the
    // comment inside runCqlRule for why that produced empty results.
    const { loadedPatientId, availablePatientKeys, rawResultsContainer, rule } = await runCqlRule(pristineBundle, ruleName);

    if (availablePatientKeys.length === 0) {
      const noResultsPayload = {
        success: false,
        error: 'Engine executed but produced no patient results.',
        loadedPatientId,
        patientBundle,
        encounterBundle,
        appointmentBundle
      };
      console.error(`CQL engine returned no patient results. Loaded patient id: ${loadedPatientId}`);
      console.log(`[RESPONSE] 422`, JSON.stringify({ ...noResultsPayload, patientBundle: '(omitted)', encounterBundle: '(omitted — see [FHIR RESPONSE]/[BUNDLE] above)' }));
      return res.status(422).json(noResultsPayload);
    }

    const normalizedFhirId = fhirId.toLowerCase();
    const matchedKey =
      availablePatientKeys.find(
        k => k.toLowerCase() === normalizedFhirId || k.toLowerCase().endsWith(`/${normalizedFhirId}`)
      ) || availablePatientKeys[0];

    const patientResults = rawResultsContainer[matchedKey];
    console.log(`[CQL RESULTS] matchedKey=${matchedKey}:`, JSON.stringify(patientResults));

    // The referral-triage rule gets a bespoke, structure-aware trace; any
    // other rule (added later via POST /api/rules) falls back to a generic
    // dump of its intermediate results.
    const evaluationTrace =
      rule.name === 'ReferralTriageLogic'
        ? traceReferralTriageEvaluation(patientResults)
        : rule.name === 'AppointmentLocationLogic'
        ? traceAppointmentLocationEvaluation(patientResults)
        : traceGenericRuleEvaluation(patientResults, rule.result_expression);

    // Every intermediate `define` the rule computed (minus the final boolean
    // itself), collapsed to a count/value per expression — a clean "what did
    // the logic actually find" summary for the UI, independent of any
    // rule-specific trace wording above. Works for any rule, not just
    // ReferralTriageLogic, since it just reads whatever named expressions
    // that rule happens to define.
    const findings = {};
    Object.keys(patientResults).forEach(key => {
      if (key === rule.result_expression) return;
      const value = patientResults[key];
      findings[key] = Array.isArray(value) ? `${value.length} found` : value;
    });

    const qualifiesForQueue = patientResults[rule.result_expression] === true;

    // AppointmentLocationLogic gets one queueItem per matching appointment
    // (each with its own location); every other rule keeps the original
    // single-item-per-patient behavior.
    let queueItems = [];
    // v2: a FHIR Bundle of exactly the resources that made the rule
    // evaluate to true — the matching logic itself is unchanged from v1,
    // this is purely additional output assembled after the boolean result.
    let matchedBundle = null;

    if (qualifiesForQueue) {
      const patientResource = patientBundle.entry[0].resource;
      const baseItem = {
        patientId: fhirId,
        identifier,
        name: extractPatientDisplayName(patientResource),
        dob: patientResource.birthDate || null,
        timestamp: new Date().toISOString(),
        status: 'Pending Action',
        ruleName: rule.name
      };

      if (rule.name === 'AppointmentLocationLogic') {
        const appointmentMatches = extractMatchingAppointmentLocations(appointmentBundle);
        queueItems = appointmentMatches.map(m => ({
          ...baseItem,
          id: `idx-${Date.now()}-${m.appointmentId}`,
          appointmentId: m.appointmentId,
          locationName: m.locationName,
          episodeName: null,
          details: `Matched rule "${rule.name}" — appointment${m.appointmentStart ? ` on ${m.appointmentStart}` : ''} at "${m.locationName}" (site code "RPY01").`
        }));

        // The CQL boolean and this JS re-derivation walk the exact same
        // partOf/participant structure, so they should always agree; this
        // is only a safety net so a "true" result is never silently
        // dropped if they somehow disagree.
        if (queueItems.length === 0) {
          queueItems = [{
            ...baseItem,
            id: `idx-${Date.now()}`,
            appointmentId: '',
            locationName: SITE_LOCATION_CODES.RPY01.displayName,
            episodeName: null,
            details: `Matched rule "${rule.name}" (${rule.result_expression}).`
          }];
        }

        matchedBundle = buildMatchedBundle(
          patientResource,
          appointmentMatches.flatMap(m => [m.apptResource, m.locationResource])
        );
      } else {
        queueItems = [{
          ...baseItem,
          id: `idx-${Date.now()}`,
          appointmentId: '',
          locationName: null,
          episodeName: extractEpisodeName(encounterBundle),
          details: `Matched rule "${rule.name}" (${rule.result_expression}).`
        }];

        if (rule.name === 'ReferralTriageLogic') {
          const { encounters, episodes } = extractMatchingEncountersAndEpisodes(encounterBundle);
          matchedBundle = buildMatchedBundle(patientResource, [...encounters, ...episodes]);
        } else {
          matchedBundle = buildMatchedBundle(patientResource, []);
        }
      }

      for (const item of queueItems) {
        item.persisted = await addToReferralQueue(item);
      }
    }

    // null = n/a (no match), true = every queued row persisted, false =
    // at least one write failed.
    const queuePersisted = queueItems.length > 0 ? queueItems.every(item => item.persisted) : null;

    const responsePayload = {
      success: true,
      ruleName: rule.name,
      ruleDescription: rule.description,
      resultExpression: rule.result_expression,
      actionRequired: qualifiesForQueue,
      // Back-compat single-item view (first/only match) plus the full list —
      // AppointmentLocationLogic can produce more than one row (one per
      // matching appointment), everything else still produces exactly one.
      queueItem: queueItems[0] || null,
      queueItems,
      queuePersisted,
      // v2: a FHIR Bundle of exactly the resources that made this
      // evaluation true (null when actionRequired is false — nothing
      // matched, so there's nothing to bundle).
      matchedBundle,
      findings,
      evaluationTrace,
      // The raw FHIR bundles as returned by the server (before de-duping/
      // merging for the CQL engine) — surfaced so the frontend can show
      // exactly what came back, e.g. in the FHIR Response Data panel.
      patientBundle,
      encounterBundle,
      appointmentBundle
    };
    console.log(`[RESPONSE] 200`, JSON.stringify({ ...responsePayload, patientBundle: '(omitted)', encounterBundle: '(omitted — see [FHIR RESPONSE]/[BUNDLE] above)' }));
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('CQL Runtime Engine Error:', error);
    const errorPayload = { success: false, error: `DEBUG: ${error.message}` };
    console.log(`[RESPONSE] 500`, JSON.stringify(errorPayload));
    return res.status(500).json(errorPayload);
  }
}
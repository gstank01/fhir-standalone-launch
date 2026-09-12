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

function extractPatientDisplayName(patientResource) {
  const name = (patientResource.name || []).find(n => n.text || n.family || (n.given && n.given.length)) || {};
  if (name.text) return name.text;
  const parts = [...(name.given || []), name.family].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Unknown';
}

// Inserts (or refreshes) a row in the referral_queue table for a patient the
// CQL engine has flagged. Failing to persist should never fail the overall
// evaluation response — the caller still needs to see the CQL result.
async function addToReferralQueue(queueItem) {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not configured; skipping referral_queue persistence.');
    return false;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO referral_queue (patient_id, identifier, name, dob, status, details, rule_name)
      VALUES (${queueItem.patientId}, ${queueItem.identifier}, ${queueItem.name}, ${queueItem.dob}, ${queueItem.status}, ${queueItem.details}, ${queueItem.ruleName})
      ON CONFLICT (patient_id) DO UPDATE SET
        identifier = EXCLUDED.identifier,
        name = EXCLUDED.name,
        dob = EXCLUDED.dob,
        status = EXCLUDED.status,
        details = EXCLUDED.details,
        rule_name = EXCLUDED.rule_name,
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
      const notFoundPayload = { success: false, error: `No FHIR Patient found for identifier: ${identifier}` };
      console.log(`[RESPONSE] 404`, JSON.stringify(notFoundPayload));
      return res.status(404).json(notFoundPayload);
    }
    const fhirId = patientBundle.entry[0].resource.id;

    // ✅ FIX: Migrated 'patient=' filter mapping to 'subject=' to adhere to strict FHIR R4 engine specifications
    const encounterBundle = await fhirGet(
      `${fhirUrl}/Encounter?subject=${fhirId}` +
        `&_include=Encounter:patient` +
        `&_include=Encounter:episode-of-care`,
      accessToken
    );

    const episodeBundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };

    const pristineBundle = buildPristineBundle([patientBundle, encounterBundle, episodeBundle]);
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
        loadedPatientId
      };
      console.error(`CQL engine returned no patient results. Loaded patient id: ${loadedPatientId}`);
      console.log(`[RESPONSE] 422`, JSON.stringify(noResultsPayload));
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
        : traceGenericRuleEvaluation(patientResults, rule.result_expression);

    const qualifiesForQueue = patientResults[rule.result_expression] === true;

    let queueItem = null;
    let queuePersisted = null; // null = n/a, true/false once we've attempted a write

    if (qualifiesForQueue) {
      const patientResource = patientBundle.entry[0].resource;
      queueItem = {
        id: `idx-${Date.now()}`,
        patientId: fhirId,
        identifier,
        name: extractPatientDisplayName(patientResource),
        dob: patientResource.birthDate || null,
        timestamp: new Date().toISOString(),
        status: 'Pending Action',
        ruleName: rule.name,
        details: `Matched rule "${rule.name}" (${rule.result_expression}).`
      };
      queuePersisted = await addToReferralQueue(queueItem);
    }

    const responsePayload = {
      success: true,
      ruleName: rule.name,
      actionRequired: qualifiesForQueue,
      queueItem,
      queuePersisted,
      evaluationTrace
    };
    console.log(`[RESPONSE] 200`, JSON.stringify(responsePayload));
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('CQL Runtime Engine Error:', error);
    const errorPayload = { success: false, error: `DEBUG: ${error.message}` };
    console.log(`[RESPONSE] 500`, JSON.stringify(errorPayload));
    return res.status(500).json(errorPayload);
  }
}
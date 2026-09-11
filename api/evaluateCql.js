const crypto = require('crypto');
const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');

let cachedLibrary = null;

function getLibrary() {
  if (cachedLibrary) return cachedLibrary;

  const compiledLogicJson = require('./logic.json');

  const fhirHelpersJson = require('./FHIRHelpers.json');

  const repository = new cql.Repository({ FHIRHelpers: fhirHelpersJson });
  cachedLibrary = new cql.Library(compiledLogicJson, repository);
  return cachedLibrary;
}

// Merge one or more raw FHIR Bundles representing a single patient into one
// "collection" Bundle that cql-exec-fhir's PatientSource can load.
// Deduplicate entries by fullUrl and filter out OperationOutcome resources
function buildPristineBundle(bundles) {
  const entryMap = new Map();

  bundles.forEach(bundle => {
    if (!bundle || !bundle.entry) return;
    bundle.entry.forEach(entry => {
      if (!entry.resource) return;
      
      // Filter out non-clinical outcome resources
      if (entry.resource.resourceType === 'OperationOutcome') return;

      const fullUrl = entry.fullUrl || `${entry.resource.resourceType}/${entry.resource.id}`;
      entry.fullUrl = fullUrl;

      // Keep only the first occurrence of each unique resource
      if (!entryMap.has(fullUrl)) {
        entryMap.set(fullUrl, entry);
      }
    });
  });

  const allEntries = Array.from(entryMap.values());
  const hasPatient = allEntries.some(e => e.resource.resourceType === 'Patient');

  if (!hasPatient) {
    const foundTypes = [...new Set(allEntries.map(e => e.resource.resourceType))].join(', ');
    throw new Error(`Merged bundle has no Patient resource. Resource types present: [${foundTypes}]`);
  }

  return { resourceType: 'Bundle', type: 'collection', entry: allEntries };
}

// Small helper for logging: counts entries by resourceType so we can see
// what actually made it into a bundle without dumping any PHI (names,
// identifiers, dates) - just resource types and counts.
function summarizeBundle(bundle) {
  const counts = {};
  (bundle?.entry || []).forEach(e => {
    const type = e?.resource?.resourceType || 'UNKNOWN';
    counts[type] = (counts[type] || 0) + 1;
  });
  return counts;
}

function runReferralTriageCql(pristineBundle) {
  console.log('CQL: merged bundle resource counts:', summarizeBundle(pristineBundle));

  const executor = new cql.Executor(getLibrary());
  // Use FHIRv401 to match FHIR 4.0.1 schema in logic.json
  const patientSource = cqlfhir.PatientSource.FHIRv401();
  patientSource.loadBundles([pristineBundle]);

  const results = executor.exec(patientSource);
  const rawResultsContainer = results?.patientResults || results || {};
  const availablePatientKeys = Object.keys(rawResultsContainer);
  console.log('CQL: exec() returned patient keys:', availablePatientKeys);

  let loadedPatientId = null;
  try {
    const diagnosticSource = cqlfhir.PatientSource.FHIRv401();
    diagnosticSource.loadBundles([pristineBundle]);
    const diagnosticPatient = diagnosticSource.currentPatient();
    loadedPatientId = diagnosticPatient ? diagnosticPatient.getId() : null;
  } catch (diagErr) {
    console.error('CQL: diagnostic patient check threw:', diagErr);
  }

  return { loadedPatientId, availablePatientKeys, rawResultsContainer };
}

async function getAccessToken({ clientID, audienceUrl, privateKeyText }) {
  const header = { alg: 'RS512', typ: 'JWT', kid: 'myapp-key-3' };
  const now = Math.floor(Date.now() / 1000);
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
  return tokenData.access_token;
}

async function fhirGet(url, accessToken) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const body = await response.json();
  if (!response.ok) {
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
    const { identifier } = req.body || {};
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

    console.log(`--- CQL WORKFLOW: identifier=${identifier} ---`);

    const accessToken = await getAccessToken({ clientID, audienceUrl, privateKeyText });

    const patientBundle = await fhirGet(
      `${fhirUrl}/Patient?identifier=${encodeURIComponent(identifier)}`,
      accessToken
    );
    if (!patientBundle.entry || patientBundle.entry.length === 0) {
      return res.status(404).json({ success: false, error: `No FHIR Patient found for identifier: ${identifier}` });
    }
    const fhirId = patientBundle.entry[0].resource.id;
    console.log(`CQL: Patient search matched fhirId=${fhirId}, entries=${patientBundle.entry.length}`);

    // Single search: Encounters for this patient, plus the Patient and any
    // EpisodeOfCare resources they reference. Multiple query params must be
    // joined with "&" (not repeated "?"), and the correct R4 search
    // parameter on Encounter for this relationship is "episode-of-care"
    // (hyphenated) - its expression is Encounter.episodeOfCare.
    const encounterBundle = await fhirGet(
      `${fhirUrl}/Encounter?patient=${fhirId}` +
        `&_include=Encounter:patient` +
        `&_include=Encounter:episode-of-care`,
      accessToken
    );

    // No separate EpisodeOfCare fetch needed - it comes back as part of
    // encounterBundle via the _include above. buildPristineBundle will pick
    // up all resource types (Patient, Encounter, EpisodeOfCare) from it.
    const episodeBundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };
    console.log('CQL: Encounter search resource counts:', summarizeBundle(encounterBundle));

    const pristineBundle = buildPristineBundle([patientBundle, encounterBundle, episodeBundle]);
    const { loadedPatientId, availablePatientKeys, rawResultsContainer } = runReferralTriageCql(pristineBundle);

    if (availablePatientKeys.length === 0) {
      console.error(`CQL engine returned no patient results. Loaded patient id: ${loadedPatientId}`);
      return res.status(422).json({
        success: false,
        error: 'Engine executed but produced no patient results.',
        // TEMPORARY DEBUG fields - safe to leave for now (counts/ids only,
        // no names/dates/PHI), but strip once this is diagnosed.
        debug: {
          loadedPatientId,
          fhirId,
          patientBundleCounts: summarizeBundle(patientBundle),
          encounterBundleCounts: summarizeBundle(encounterBundle),
          mergedBundleCounts: summarizeBundle(pristineBundle)
        }
      });
    }

    const normalizedFhirId = fhirId.toLowerCase();
    const matchedKey =
      availablePatientKeys.find(
        k => k.toLowerCase() === normalizedFhirId || k.toLowerCase().endsWith(`/${normalizedFhirId}`)
      ) || availablePatientKeys[0];

    const patientResults = rawResultsContainer[matchedKey];
    const qualifiesForQueue = patientResults['Is Valid Referral Triage Process'] === true;

    return res.status(200).json({
      success: true,
      actionRequired: qualifiesForQueue,
      queueItem: qualifiesForQueue
        ? {
            id: `idx-${Date.now()}`,
            patientId: fhirId,
            timestamp: new Date().toISOString(),
            status: 'Pending Action',
            details: 'Referral criteria matched via local ELM JSON execution.'
          }
        : null
    });
  } catch (error) {
    console.error('CQL Runtime Engine Error:', error);
    // TEMPORARY DEBUG - revert once diagnosed
    return res.status(500).json({ success: false, error: `DEBUG: ${error.message}` });
  }
}

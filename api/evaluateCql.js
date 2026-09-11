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

// Merge and deduplicate raw FHIR Bundles into a single collection Bundle
function buildPristineBundle(bundles) {
  const entryMap = new Map();

  bundles.forEach(bundle => {
    if (!bundle || !bundle.entry) return;
    bundle.entry.forEach(entry => {
      if (!entry.resource) return;

      // Omit non-clinical OperationOutcome resources
      if (entry.resource.resourceType === 'OperationOutcome') return;

      const fullUrl = entry.fullUrl || `${entry.resource.resourceType}/${entry.resource.id}`;
      entry.fullUrl = fullUrl;

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

  // 1. Un-iterated PatientSource strictly for execution
  const executionSource = cqlfhir.PatientSource.FHIRv400();
  executionSource.loadBundles([pristineBundle]);

  // Execute directly without touching executionSource cursor beforehand
  const results = executor.exec(executionSource);
  const rawResultsContainer = results?.patientResults || results || {};
  const availablePatientKeys = Object.keys(rawResultsContainer);
  console.log('CQL: exec() returned patient keys:', availablePatientKeys);

  // 2. Separate PatientSource instance strictly for diagnostic ID extraction
  let loadedPatientId = null;
  try {
    const diagSource = cqlfhir.PatientSource.FHIRv400();
    diagSource.loadBundles([pristineBundle]);
    const diagPatient = diagSource.currentPatient();
    loadedPatientId = diagPatient ? diagPatient.getId() : null;
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

    const encounterBundle = await fhirGet(
      `${fhirUrl}/Encounter?patient=${fhirId}&_include=Encounter:patient&_include=Encounter:episode-of-care`,
      accessToken
    );

    const episodeBundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };

    const pristineBundle = buildPristineBundle([patientBundle, encounterBundle, episodeBundle]);
    const { loadedPatientId, availablePatientKeys, rawResultsContainer } = runReferralTriageCql(pristineBundle);

    if (availablePatientKeys.length === 0) {
      console.error(`CQL engine returned no patient results. Loaded patient id: ${loadedPatientId}`);
      return res.status(422).json({
        success: false,
        error: 'Engine executed but produced no patient results.',
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
    return res.status(500).json({ success: false, error: `DEBUG: ${error.message}` });
  }
}

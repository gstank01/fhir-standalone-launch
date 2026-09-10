const crypto = require('crypto');
const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const fs = require('fs');
const path = require('path');

// --- Load compiled CQL ELM + its dependency libraries lazily (see getLibrary) ---
function loadJsonRelativeToApi(filename) {
  const primary = path.join(process.cwd(), 'api', filename);
  const fallback = path.join(process.cwd(), filename);
  const target = fs.existsSync(primary) ? primary : fallback;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

// Loaded lazily (on first use, inside getLibrary()) rather than at module
// top-level. If logic.json or FHIRHelpers.json are missing/malformed,
// throwing here at import time would crash the whole serverless function
// before the route handler's try/catch ever runs, producing a platform
// error page instead of a JSON error response. Loading lazily means any
// failure happens *inside* the handler's try/catch instead.
let cachedLibrary = null;

function getLibrary() {
  if (cachedLibrary) return cachedLibrary;

  const compiledLogicJson = loadJsonRelativeToApi('logic.json');

  // FHIRHelpers.json is the compiled ELM for FHIRHelpers.cql (version 4.0.1).
  // logic.json's "includes" section references FHIRHelpers, and statements
  // like "Referral Triage Encounters" call FHIRHelpers.ToConcept directly -
  // without handing this library to cql-execution via a Repository, that
  // FunctionRef can't be resolved and the engine won't produce results.
  const fhirHelpersJson = loadJsonRelativeToApi('FHIRHelpers.json');

  const repository = new cql.Repository({ FHIRHelpers: fhirHelpersJson });
  cachedLibrary = new cql.Library(compiledLogicJson, repository);
  return cachedLibrary;
}

// Merge one or more raw FHIR Bundles representing a single patient into one
// "collection" Bundle that cql-exec-fhir's PatientSource can load.
function buildPristineBundle(bundles) {
  const allEntries = [];

  bundles.forEach(bundle => {
    if (!bundle || !bundle.entry) return;
    bundle.entry.forEach(entry => {
      if (!entry.resource) return;
      if (!entry.fullUrl) {
        entry.fullUrl = `${entry.resource.resourceType}/${entry.resource.id}`;
      }
      allEntries.push(entry);
    });
  });

  const hasPatient = allEntries.some(e => e.resource.resourceType === 'Patient');
  if (!hasPatient) {
    const foundTypes = [...new Set(allEntries.map(e => e.resource.resourceType))].join(', ');
    throw new Error(`Merged bundle has no Patient resource. Resource types present: [${foundTypes}]`);
  }

  return { resourceType: 'Bundle', type: 'collection', entry: allEntries };
}

function runReferralTriageCql(pristineBundle) {
  const executor = new cql.Executor(getLibrary());
  const patientSource = cqlfhir.PatientSource.FHIRv400();

  patientSource.loadBundles([pristineBundle]);

  const loadedPatient = patientSource.currentPatient();
  const loadedPatientId = loadedPatient ? loadedPatient.getId() : null;
  patientSource.reset();

  const results = executor.exec(patientSource);
  const rawResultsContainer = results?.patientResults || results || {};
  const availablePatientKeys = Object.keys(rawResultsContainer);

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

    const encounterBundle = await fhirGet(
      `${fhirUrl}/Encounter?patient=${fhirId}&_include=Encounter:patient`,
      accessToken
    );

    // EpisodeOfCare doesn't support a "patient" search parameter on this
    // FHIR server - it has to be searched via "encounter" instead. Pull the
    // Encounter ids out of the bundle we already have and search on those.
    // (encounterBundle may also contain the _include'd Patient resource, so
    // filter to just Encounter entries first.)
    const encounterRefs = (encounterBundle.entry || [])
      .filter(e => e.resource && e.resource.resourceType === 'Encounter')
      .map(e => `Encounter/${e.resource.id}`);

    const episodeBundle = encounterRefs.length > 0
      ? await fhirGet(`${fhirUrl}/EpisodeOfCare?encounter=${encounterRefs.join(',')}`, accessToken)
      : { resourceType: 'Bundle', type: 'searchset', entry: [] };

    const pristineBundle = buildPristineBundle([patientBundle, encounterBundle, episodeBundle]);
    const { loadedPatientId, availablePatientKeys, rawResultsContainer } = runReferralTriageCql(pristineBundle);

    if (availablePatientKeys.length === 0) {
      console.error(`CQL engine returned no patient results. Loaded patient id: ${loadedPatientId}`);
      return res.status(422).json({
        success: false,
        error: 'Engine executed but produced no patient results.',
        loadedPatientId
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

const crypto = require('crypto');
const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

// --- Global Token Cache Strategy ---
let tokenCache = { access_token: null, expiresAt: 0 };

function loadJsonRelativeToApi(filename) {
  const primary = path.join(process.cwd(), 'api', filename);
  const fallback = path.join(process.cwd(), filename);
  const target = fs.existsSync(primary) ? primary : fallback;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

let cachedLibrary = null;

// This function is now async because it queries the database
async function getLibrary() {
  if (cachedLibrary) return cachedLibrary;

  const compiledLogicJson = loadJsonRelativeToApi('logic.json');
  const fhirHelpersJson = loadJsonRelativeToApi('FHIRHelpers.json');

  const repository = new cql.Repository({ FHIRHelpers: fhirHelpersJson });
  cachedLibrary = new cql.Library(compiledLogicJson, repository);
  
  return cachedLibrary;
}

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

  // ✅ FIX: Execute engine matching BEFORE resetting the data collection iterator
  const results = executor.exec(patientSource);
  patientSource.reset(); 

  const rawResultsContainer = results?.patientResults || results || {};
  const availablePatientKeys = Object.keys(rawResultsContainer);

  return { loadedPatientId, availablePatientKeys, rawResultsContainer };
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
      INSERT INTO referral_queue (patient_id, identifier, name, dob, status, details)
      VALUES (${queueItem.patientId}, ${queueItem.identifier}, ${queueItem.name}, ${queueItem.dob}, ${queueItem.status}, ${queueItem.details})
      ON CONFLICT (patient_id) DO UPDATE SET
        identifier = EXCLUDED.identifier,
        name = EXCLUDED.name,
        dob = EXCLUDED.dob,
        status = EXCLUDED.status,
        details = EXCLUDED.details,
        updated_at = now()
    `;
    return true;
  } catch (error) {
    console.error('Neon DB Error while writing referral_queue:', error);
    return false;
  }
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

    // ✅ FIX: Migrated 'patient=' filter mapping to 'subject=' to adhere to strict FHIR R4 engine specifications
    const encounterBundle = await fhirGet(
      `${fhirUrl}/Encounter?subject=${fhirId}` +
        `&_include=Encounter:patient` +
        `&_include=Encounter:episode-of-care`,
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
        details: 'Referral criteria matched via local ELM JSON execution.'
      };
      queuePersisted = await addToReferralQueue(queueItem);
    }

    return res.status(200).json({
      success: true,
      actionRequired: qualifiesForQueue,
      queueItem,
      queuePersisted
    });
  } catch (error) {
    console.error('CQL Runtime Engine Error:', error);
    return res.status(500).json({ success: false, error: `DEBUG: ${error.message}` });
  }
}
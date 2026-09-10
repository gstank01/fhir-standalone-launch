const crypto = require('crypto');
const { buildPristineBundle, runReferralTriageCql } = require('./lib/cqlEngine');

// Global memory registry to track authorization instances across function lifecycles
let authorizationCache = { token: null, invalidationTimestamp: 0 };

/**
 * Base64Url encoding mechanism to meet JWT cryptographic requirements
 */
const base64UrlEncode = input =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

/**
 * Securely signs and retrieves an OAuth access token from the Identity Provider
 */
async function getAccessToken({ clientID, audienceUrl, privateKeyText, tokenEndpointUrl }) {
  const currentEpochTime = Math.floor(Date.now() / 1000);

  // Return token directly from memory cache if within valid parameters (with a 15s expiration safety margin)
  if (authorizationCache.token && authorizationCache.invalidationTimestamp > currentEpochTime + 15) {
    return authorizationCache.token;
  }

  const jwtHeader = { alg: 'RS512', typ: 'JWT', kid: process.env.FHIR_KEY_ID || 'myapp-key-3' };
  const jwtPayload = {
    iss: clientID,
    sub: clientID,
    aud: audienceUrl,
    exp: currentEpochTime + 300,
    jti: crypto.randomUUID().toUpperCase()
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(jwtHeader));
  const encodedPayload = base64UrlEncode(JSON.stringify(jwtPayload));
  const signatureSigningInput = `${encodedHeader}.${encodedPayload}`;

  const signerInstance = crypto.createSign('RSA-SHA512');
  signerInstance.update(signatureSigningInput);
  signerInstance.end();
  
  const cryptographicSignature = signerInstance.sign(privateKeyText, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
    
  const clientAssertionString = `${signatureSigningInput}.${cryptographicSignature}`;

  const tokenRequestBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertionString
  });

  // FIX: Directed targeted query request context to tokenEndpointUrl rather than audienceUrl identifier
  const tokenResponse = await fetch(tokenEndpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenRequestBody.toString()
  });

  const responsePayload = await tokenResponse.json();
  if (!tokenResponse.ok || !responsePayload.access_token) {
    throw new Error(`Token exchange failed: ${JSON.stringify(responsePayload)}`);
  }

  authorizationCache = {
    token: responsePayload.access_token,
    invalidationTimestamp: currentEpochTime + (responsePayload.expires_in || 300)
  };

  return authorizationCache.token;
}

/**
 * Standard utility wrapper for executing authenticated FHIR API requests
 */
async function fhirGet(url, accessToken) {
  const networkResponse = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  
  const standardResponseBody = await networkResponse.json();
  if (!networkResponse.ok) {
    throw new Error(`FHIR request failed (${url}): ${JSON.stringify(standardResponseBody)}`);
  }
  return standardResponseBody;
}

/**
 * Primary Serverless Route Handler Export Engine
 */
export default async function handler(req, res) {
  // CORS Lock configurations configured via systemic environmental infrastructure checks
  const restrictedProductionOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', restrictedProductionOrigin);
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
    const tokenEndpointUrl = process.env.OAUTH_TOKEN_URL || audienceUrl; // Fallback handling if intentionally shared
    let privateKeyText = process.env.BACKEND_APP_KEY;
    const fhirUrl = process.env.FHIRURL;

    if (!privateKeyText || !clientID || !audienceUrl || !fhirUrl) {
      throw new Error('Missing required environment variables (CLIENTID, AUDIENCEURL, BACKEND_APP_KEY, FHIRURL).');
    }
    privateKeyText = privateKeyText.replace(/\\n/g, '\n');

    console.log(`--- CQL WORKFLOW: identifier=${identifier} ---`);

    // --- Step 1: Securely fetch or retrieve a cached OAuth Access Token ---
    const accessToken = await getAccessToken({ clientID, audienceUrl, privateKeyText, tokenEndpointUrl });

    // --- Step 2: Query for targeted patient context via identifier token ---
    const patientBundle = await fhirGet(
      `${fhirUrl}/Patient?identifier=${encodeURIComponent(identifier)}`,
      accessToken
    );
    if (!patientBundle.entry || patientBundle.entry.length === 0) {
      return res.status(404).json({ success: false, error: `No FHIR Patient found for identifier: ${identifier}` });
    }
    const fhirId = patientBundle.entry[0].resource.id;

    // --- Step 3: Run isolated patient asset metrics queries in parallel ---
    // FIX: Updated resource filtering syntax from patient= to subject= to strictly comply with FHIR R4 specifications
    const [encounterBundle, episodeBundle] = await Promise.all([
      fhirGet(`${fhirUrl}/Encounter?subject=${fhirId}&_include=Encounter:patient`, accessToken),
      fhirGet(`${fhirUrl}/EpisodeOfCare?patient=${fhirId}`, accessToken)
    ]);

    // --- Step 4: Aggregate collected payloads and execute clinical logic parsing ---
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
    return res.status(500).json({ success: false, error: 'Internal error evaluating referral triage logic.' });
  }
}

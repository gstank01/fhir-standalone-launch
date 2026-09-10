const crypto = require('crypto');
const { buildPristineBundle, runReferralTriageCql } = require('./lib/cqlEngine');

export default async function handler(req, res) {
  // Lock CORS down to your actual frontend origin via env var in production.
  // '*' is not appropriate for an endpoint that triggers PHI lookups.
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

    // --- Step 1: backend-service JWT assertion -> access token ---
    const accessToken = await getAccessToken({ clientID, audienceUrl, privateKeyText });

    // --- Step 2: Patient lookup by external identifier ---
    const patientBundle = await fhirGet(
      `${fhirUrl}/Patient?identifier=${encodeURIComponent(identifier)}`,
      accessToken
    );
    if (!patientBundle.entry || patientBundle.entry.length === 0) {
      return res.status(404).json({ success: false, error: `No FHIR Patient found for identifier: ${identifier}` });
    }
    const fhirId = patientBundle.entry[0].resource.id;

    // --- Step 3: Encounters + EpisodesOfCare for that patient ---
    // NOTE: the CQL's "Is Valid Referral Triage Process" statement requires
    // an active EpisodeOfCare matching the Encounter's episodeOfCare
    // reference - that resource type must be fetched, or the statement will
    // always evaluate false regardless of the Encounter data.
    const [encounterBundle, episodeBundle] = await Promise.all([
      fhirGet(`${fhirUrl}/Encounter?patient=${fhirId}&_include=Encounter:patient`, accessToken),
      fhirGet(`${fhirUrl}/EpisodeOfCare?patient=${fhirId}`, accessToken)
    ]);

    // --- Step 4: merge into one pristine bundle & run the CQL ---
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
    // Log full detail server-side, but don't echo internal error messages
    // (stack traces, internal URLs, library errors) back to the client.
    console.error('CQL Runtime Engine Error:', error);
    return res.status(500).json({ success: false, error: 'Internal error evaluating referral triage logic.' });
  }
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

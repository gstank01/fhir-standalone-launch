const crypto = require('crypto');

// --- Global Token Cache Strategy (mirrors evaluateCql.js) ---
let tokenCache = { access_token: null, expiresAt: 0 };

const base64UrlEncode = input =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

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

  tokenCache = {
    access_token: tokenData.access_token,
    expiresAt: now + (tokenData.expires_in || 300)
  };

  return tokenCache.access_token;
}

/**
 * Issues a backend-signed OAuth access token plus the configured FHIR base URL
 * so the browser can perform the Patient/Encounter lookups itself, without ever
 * seeing the private key. Used by the "GET Referral Info" flow (referrals-app.js).
 */
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

    console.log(`--- GET PATIENT TOKEN: identifier=${identifier} ---`);

    const accessToken = await getAccessToken({ clientID, audienceUrl, privateKeyText });

    return res.status(200).json({
      success: true,
      token: accessToken,
      fhirUrl
    });
  } catch (error) {
    console.error('getPatient Token Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

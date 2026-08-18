import crypto from 'crypto';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        console.log("--- STARTING VERCEL BACKEND WORKFLOW ---");

        const clientID = process.env.CLIENTID; 
        const audienceUrl = process.env.AUDIENCEURL; 
        let privateKeyText = process.env.BACKEND_APP_KEY; 

        if (!privateKeyText || !clientID || !audienceUrl) {
            throw new Error("Missing required environment variables.");
        }

        // VERCEL FIX: Restore escaped newlines in the private key
        privateKeyText = privateKeyText.replace(/\\n/g, '\n');

        const { identifier } = req.body || {};
        console.log(`Received identifier from frontend: ${identifier}`);

        // --- STEP A: Generate Client Assertion (JWT) ---
        const header = { "alg": "RS512", "typ": "JWT", "kid": "myapp-key-3" };
        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iss: clientID,
            sub: clientID,
            aud: audienceUrl,
            exp: now + 300,
            jti: crypto.randomUUID().toUpperCase() 
        };

        const base64UrlEncode = (input) => Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        
        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        const signingInput = `${encodedHeader}.${encodedPayload}`;

        // --- DEBUG OUTPUT: JWT Components ---
        console.log("--- DEBUG: JWT COMPONENTS ---");
        console.log("Encoded Header:", encodedHeader);
        console.log("Encoded Payload:", encodedPayload);

        const sign = crypto.createSign('RSA-SHA512');
        sign.update(signingInput);
        sign.end();

        const signature = sign.sign(privateKeyText, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const clientAssertion = `${signingInput}.${signature}`;

        // --- DEBUG OUTPUT: Final JWT Client Assertion ---
        console.log("--- DEBUG: FINAL JWT CLIENT ASSERTION ---");
        console.log(clientAssertion);


        // --- STEP B: Exchange Assertion for Access Token ---
        const tokenRequestBody = new URLSearchParams({
            grant_type: 'client_credentials',
            client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
            client_assertion: clientAssertion
        });

        // --- DEBUG OUTPUT: Full Outbound API Request ---
        console.log("--- DEBUG: OUTBOUND TOKEN REQUEST ---");
        console.log("Target URL:", audienceUrl);
        console.log("Method: POST");
        console.log("Headers: Content-Type: application/x-www-form-urlencoded");
        console.log("Request Body Parameters:", tokenRequestBody.toString());

        const tokenResponse = await fetch(audienceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenRequestBody.toString()
        });

        const tokenData = await tokenResponse.json();

        // --- DEBUG OUTPUT: Exact Token Endpoint Response ---
        console.log("--- DEBUG: TOKEN ENDPOINT RESPONSE ---");
        console.log("Response Status:", tokenResponse.status, tokenResponse.statusText);
        console.log("Response JSON Body:", JSON.stringify(tokenData, null, 2));

        if (!tokenResponse.ok || !tokenData.access_token) {
            throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
        }

        // Success! Send it back to the browser.
        return res.status(200).json({ 
            success: true, 
            message: "Token acquired on Vercel successfully!",
            token: tokenData.access_token,
            identifier: identifier
        });

    } catch (error) {
        console.error("Backend Workflow Error:", error.message || error);
        return res.status(500).json({ success: false, error: error.message || "Internal Server Error" });
    }
}

// api/getToken.js
const crypto = require('crypto'); // Node native crypto module

export default async function handler(req, res) {
    // Only allow POST requests for security
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        console.log("--- STARTING BACKEND ASSERTION GENERATION ---");
        
        // Vercel securely injects these from your Project Settings -> Environment Variables
        const clientID = process.env.CLIENTID; 
        const audienceUrl = process.env.AUDIENCEURL; 
        const privateKeyText = process.env.BACKEND_APP_PK; 

        if (!privateKeyText || !clientID || !audienceUrl) {
            throw new Error("One or more required environment variables (CLIENTID, AUDIENCEURL, BACKEND_APP_PK) are empty!");
        }

        // Construct header
        const header = {
            "alg": "RS512",
            "typ": "JWT",
            "kid": "myapp-key-3" // Make sure this matches your registered JWKS kid
        };

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iss: clientID,
            sub: clientID,
            aud: audienceUrl,
            exp: now + 300, // Token valid for 5 minutes
            jti: crypto.randomUUID().toUpperCase() 
        };

        const base64UrlEncode = (input) => {
            return Buffer.from(input)
                .toString('base64')
                .replace(/=/g, '')
                .replace(/\+/g, '-')
                .replace(/\//g, '_');
        };

        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedPayload = base64UrlEncode(JSON.stringify(payload));
        
        const signingInput = `${encodedHeader}.${encodedPayload}`;

        // Sign using Node.js Native Crypto (RS512)
        const sign = crypto.createSign('RSA-SHA512');
        sign.update(signingInput);
        sign.end();

        const signature = sign.sign(privateKeyText, 'base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');

        const generatedAssertion = `${signingInput}.${signature}`;
        
        console.log("Client Assertion Token Generated Successfully!");

        // Send the assertion back to the frontend (or we can use it directly in the next step)
        return res.status(200).json({ 
            success: true, 
            assertion: generatedAssertion 
        });

    } catch (error) {
        console.error("CRITICAL SCRIPT ERROR CAUGHT:", error);
        // Send a proper HTTP 500 error back to the frontend instead of crashing
        return res.status(500).json({ 
            success: false, 
            error: error.message || "Internal Server Error" 
        });
    }
}

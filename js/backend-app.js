//this code is used to generate client assertion
const crypto = require('crypto'); //Node native crypto module
const fs = require('fs'); //allow writing to files

try {
    console.log("--- STARTING BACKEND ASSERTION SCRIPT (NATIVE CRYPTO) ---");
    
    const clientID = process.env.CLIENTID; //replace the variable with with your client id
    const audienceUrl = process.env.AUDIENCEURL; //replace variable with the server token endpoint 
    
    // Pull the secret from GitHub secrets
    const privateKeyText = process.env.BACKEND_APP_PK; 

    if (!privateKeyText || !clientID || !audienceUrl) {
        throw new Error("One or more required environment variables (CLIENTID, AUDIENCEURL, BACKEND_APP_PK) are empty!");
    }

    //construct header
    const header = {
        "alg": "RS512",
        "typ": "JWT",
        "kid": "myapp-key-3"
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: clientID,
        sub: clientID,
        aud: audienceUrl,
        exp: now + 300,
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

    console.log("Header:", encodedHeader);
 
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    
    console.log("Encoded Payload:", encodedPayload);
    
    const signingInput = `${encodedHeader}.${encodedPayload}`;


    // Sign using Node.js Native Crypto (RS512)
    console.log("Signing JWT using native Node.js crypto...");
    const sign = crypto.createSign('RSA-SHA512');
    sign.update(signingInput);
    sign.end();

    const signature = sign.sign(privateKeyText, 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    const generatedToken = `${signingInput}.${signature}`;
    
    // Print length of signature to verify it generated without leaking the key
    console.log("Signature length:", signature.length);

    console.log("Client Assertion Token Generated Successfully!");
    console.log(generatedToken);

    // Check if running inside GitHub Actions, and write the token to the environment
    if (process.env.GITHUB_ENV) {
        fs.appendFileSync(process.env.GITHUB_ENV, `CLIENT_ASSERTION=${generatedToken}\n`);
        console.log("Successfully exported CLIENT_ASSERTION to GitHub Environment.");
    }

} catch (error) {
    console.error("CRITICAL SCRIPT ERROR CAUGHT:");
    console.error(error.message || error);
    process.exit(1); 
}

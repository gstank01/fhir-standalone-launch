const jsrsasign = require('jsrsasign'); //library
const crypto = require('crypto'); 

try {
    const clientID = process.env.CLIENTID; //replace the variable with with your client id
    const audienceUrl = process.env.AUDIENCEURL; //replace variable with the server token endpoint 

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

    // Pull the secret from GitHub secrets
    const privateKeyText = process.env.BACKEND_APP_PK; 

    if (!privateKeyText) {
        console.error("Error: BACKEND_APP_PK environment variable is empty!");
        process.exit(1); 
    }

    const sHeader = JSON.stringify(header);
    const sPayload = JSON.stringify(payload);

    const generatedToken = jsrsasign.KJUR.jws.JWS.sign("RS512", sHeader, sPayload, privateKeyText);

    console.log("Client Assertion Token Generated Successfully!", generatedToken);

} catch (error) {
    console.error("Script Error:", error);
    process.exit(1); 
}

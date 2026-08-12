const jsrsasign = require('jsrsasign'); //library
const crypto = require('crypto'); 

try {
    const myClientID = "43389778-2aae-479e-92b2-68caad2e5e74";//replace with your client 
    const audienceUrl = "https://epicproxy-np.et1059.epichosted.com/FHIRProxy/oauth2/token"; //replace with token endpoint 

    const header = {
        "alg": "RS512",
        "typ": "JWT",
        "kid": "myapp-key-3"
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: myClientID,
        sub: myClientID,
        aud: audienceUrl,
        exp: now + 300,
        jti: crypto.randomUUID().toUpperCase() 
    };

    // Pull the secret from GitHub Actions
    const privateKeyText = process.env.BACKEND_APP_PK; 

    if (!privateKeyText) {
        console.error("Error: BACKEND_APP_PK environment variable is empty!");
        process.exit(1); 
    }

    const sHeader = JSON.stringify(header);
    const sPayload = JSON.stringify(payload);

    const generatedToken = jsrsasign.KJUR.jws.JWS.sign("RS512", sHeader, sPayload, privateKeyText);

    console.log("Client Assertion Token Generated Successfully!");
    console.log(generatedToken);

} catch (error) {
    console.error("Script Error:", error);
    process.exit(1); 
}

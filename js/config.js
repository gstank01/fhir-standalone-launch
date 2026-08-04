// config.js
const CONFIG = {
    // Epic Sandbox Configuration
    CLIENT_ID: 'Replace with your non-production Client ID',
    FHIR_BASE_URL: 'Replace with the FHIR Server Base URL',
    AUTH_URL: 'Replace with the FHIR Server autorization endpoin',
    TOKEN_URL: 'Replace with the FHIR Server token endpoint',
    
    // Dynamically generate Redirect URI pointing back to current page path
    REDIRECT_URI: 'https://gstank01.github.io/fhir-standalone-launch/index.html',
    
    // Scopes required by Epic standalone launch
    SCOPES: 'aunch openid fhirUser' // Add additional FHIR resource scopes here. This is the bare minimum for the app to work
};

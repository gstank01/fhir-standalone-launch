// config.js
const CONFIG = {
    // Epic Sandbox Configuration
    CLIENT_ID: 'Your non-production Client ID',
    FHIR_BASE_URL: 'Your FHIR Base URL',
    AUTH_URL: 'FHIR Server autorization endpoin',
    TOKEN_URL: 'FHIR Server token endpoint',
    
    // Dynamically generate Redirect URI pointing back to current page path
    REDIRECT_URI: 'https://gstank01.github.io/fhir-standalone-launch/index.html',
    
    // Scopes required by Epic standalone launch
    SCOPES: 'aunch openid fhirUser' // Add additional FHIR resource scopes here. This is the bare minimum for the app to work
};

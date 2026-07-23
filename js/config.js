// config.js
const CONFIG = {
    // Epic Sandbox Configuration
    CLIENT_ID: 'ef3b2af6-c1b8-4421-9dda-108c6ac8afce',
    FHIR_BASE_URL: 'https://vendorservices.epic.com/interconnect-amcurprd-oauth/api/FHIR/R4',
    AUTH_URL: 'https://vendorservices.epic.com/interconnect-amcurprd-oauth/oauth2/authorize',
    TOKEN_URL: 'https://vendorservices.epic.com/interconnect-amcurprd-oauth/oauth2/token',
    
    // Dynamically generate Redirect URI pointing back to current page path
    REDIRECT_URI: window.location.origin + window.location.pathname,
    
    // Scopes required by Epic standalone launch
    SCOPES: 'aunch openid fhirUser' // Add additional FHIR resource scopes here. This is the bare minimum for the app to work
};

// This object provides clean, centralized helper methods to read, write, and clear authentication state in sessionStorage.

const AuthStore = {
    // --- Auth Code ---
    getAuthCode: () => sessionStorage.getItem('fhir_auth_code'),
    setAuthCode: (code) => sessionStorage.setItem('fhir_auth_code', code),
    
    // --- Pending Auth URL ---
    getPendingAuthUrl: () => sessionStorage.getItem('fhir_pending_auth_url'),
    setPendingAuthUrl: (url) => sessionStorage.setItem('fhir_pending_auth_url', url),

    // --- Access Token ---
    getAccessToken: () => sessionStorage.getItem('fhir_access_token'),
    setAccessToken: (token) => sessionStorage.setItem('fhir_access_token', token),

    // --- CSRF State / PKCE ---
    getState: () => sessionStorage.getItem('fhir_state'),
    setState: (state) => sessionStorage.setItem('fhir_state', state),

    // --- Helper to clear everything on logout or error ---
    clearAll: () => {
        sessionStorage.removeItem('fhir_auth_code');
        sessionStorage.removeItem('fhir_pending_auth_url');
        sessionStorage.removeItem('fhir_access_token');
        sessionStorage.removeItem('fhir_state');
    }
};

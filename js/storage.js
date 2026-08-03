// This object provides clean, centralised helper methods to read, write, and clear authentication in sessionStorage.
/**
 * AuthStore: Centralised storage abstraction for OAuth2 / SMART on FHIR tokens and unique state.
 * - Prevents string-typo bugs and standardises sessionStorage key management.
 * - Persists transient auth values across OAuth popup redirects and workspace steps.
 * - Provides clean cleanup (.clearAll()) for security resets and error handling.
 */

const AuthStore = {
    // --- Stores the full auth URL that will be sent to Epic  ---
    getPendingAuthUrl: () => sessionStorage.getItem('fhir_pending_auth_url'),
    setPendingAuthUrl: (url) => sessionStorage.setItem('fhir_pending_auth_url', url),
    
    // --- Stores the authorisation code reseived from the Epic ---
    getAuthCode: () => sessionStorage.getItem('fhir_auth_code'),
    setAuthCode: (code) => sessionStorage.setItem('fhir_auth_code', code),
    
    // --- Access Token ---
    getAccessToken: () => sessionStorage.getItem('fhir_access_token'),
    setAccessToken: (token) => sessionStorage.setItem('fhir_access_token', token),

    // --- State ---
    getState: () => sessionStorage.getItem('fhir_state'),
    setState: (state) => sessionStorage.setItem('fhir_state', state),

    // --- RIS Patient Context Session Helpers - store and retrieve the active patient context during session management
    getPatientContext: () => {
        const raw = sessionStorage.getItem('ris_active_patient_context');
        return raw ? JSON.parse(raw) : null;
    },
    setPatientContext: (patientData) => {
        sessionStorage.setItem('ris_active_patient_context', JSON.stringify(patientData));
    },

    // --- Helper to clear everything on logout or error ---
    //Deletes specific OAuth key-value pairs stored during authentication using sessionStorage.removeItem()
    clearAll: () => {
        sessionStorage.removeItem('fhir_auth_code');
        sessionStorage.removeItem('fhir_pending_auth_url');
        sessionStorage.removeItem('fhir_access_token');
        sessionStorage.removeItem('fhir_state');
        sessionStorage.removeItem('ris_active_patient_context');
    }
};

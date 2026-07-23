// --- RANDOM STRING GENERATOR (For CSRF State) ---
function generateRandomString(length = 32) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const values = new Uint8Array(length);
    crypto.getRandomValues(values);
    return Array.from(values).map(x => possible[x % possible.length]).join('');
}

// --- LOGGING HELPER ---
function log(message) {
    const div = document.getElementById('logs');
    if (!div) return;
    div.innerHTML += `<div>[${new Date().toLocaleTimeString()}] ${message}</div>`;
    div.scrollTop = div.scrollHeight;
}

// Global variables to store auth values between steps
let capturedAuthCode = '';
let pendingAuthUrl = '';
let currentAccessToken = '';

// --- 1. CALLBACK HANDLER (Runs inside Pop-up when redirected back from EHR) ---
(function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const returnedState = urlParams.get('state');

    if (code) {
        if (window.opener) {
            // Send code and state back to main dashboard window
            window.opener.postMessage({ 
                type: 'AUTH_CODE', 
                code: code, 
                state: returnedState 
            }, window.location.origin);
            window.close();
        }
    }
})();

// --- 2. MAIN APPLICATION LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    // Safety check for CONFIG
    if (typeof CONFIG === 'undefined') {
        log("CRITICAL ERROR: 'CONFIG' is not defined. Ensure js/config.js is loaded before js/app.js in index.html!");
        return;
    }

    const launchBtn = document.getElementById('launchBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const confirmLaunchBtn = document.getElementById('confirmLaunchBtn');
    const cancelCodeBtn = document.getElementById('cancelCodeBtn');
    const confirmTokenExchangeBtn = document.getElementById('confirmTokenExchangeBtn');
    const cancelFhirBtn = document.getElementById('cancelFhirBtn');
    const confirmFhirFetchBtn = document.getElementById('confirmFhirFetchBtn');

    // Safe DOM value getters/setters
    const getVal = (id) => document.getElementById(id)?.value || '';
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    // Helper to update Step 1 GET Request Preview URL live
    function updatePreviewUrl() {
        const endpoint = getVal('m-endpoint');
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: getVal('m-client-id'),
            redirect_uri: getVal('m-redirect-uri'),
            state: getVal('m-state'),
            scope: getVal('m-scope'),
            aud: getVal('m-aud')
        });

        pendingAuthUrl = `${endpoint}?${params.toString()}`;
        const fullUrlEl = document.getElementById('m-full-url');
        if (fullUrlEl) fullUrlEl.textContent = pendingAuthUrl;
    }

    // Attach dynamic typing listeners to pre-flight inputs
    document.querySelectorAll('.param-input').forEach(input => {
        input.addEventListener('input', updatePreviewUrl);
    });

    // STEP 1: Trigger Button -> Open Pre-Flight Modal
    launchBtn?.addEventListener('click', () => {
        try {
            log("Generating authorization parameters...");

            const state = generateRandomString(32);
            sessionStorage.setItem('fhir_state', state);

            setVal('m-endpoint', CONFIG.AUTH_URL);
            setVal('m-client-id', CONFIG.CLIENT_ID);
            setVal('m-redirect-uri', CONFIG.REDIRECT_URI);
            setVal('m-aud', CONFIG.FHIR_BASE_URL);
            setVal('m-state', state);
            setVal('m-scope', CONFIG.SCOPES);

            updatePreviewUrl();

            const modal = document.getElementById('preflightModal');
            if (modal) {
                modal.classList.add('active');
                log("Pre-flight screen displayed. Edit fields as needed.");
            } else {
                log("ERROR: Couldn't find element with id='preflightModal' in index.html");
            }
        } catch (err) {
            log(`RUNTIME ERROR: ${err.message}`);
        }
    });

    // Pre-Flight Modal -> Cancel
    cancelModalBtn?.addEventListener('click', () => {
        document.getElementById('preflightModal')?.classList.remove('active');
        log("Launch canceled by user.");
    });

    // Pre-Flight Modal -> Confirm & Launch Auth Popup Window
    confirmLaunchBtn?.addEventListener('click', () => {
        try {
            const currentState = getVal('m-state');
            sessionStorage.setItem('fhir_state', currentState);

            updatePreviewUrl();

            document.getElementById('preflightModal')?.classList.remove('active');
            log("Opening secure authentication pop-up...");
            window.open(pendingAuthUrl, 'FHIR Auth', 'width=600,height=700');
        } catch (err) {
            log(`LAUNCH ERROR: ${err.message}`);
        }
    });

    // Step 2/3 Modal -> Abort Exchange
    cancelCodeBtn?.addEventListener('click', () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Token exchange aborted by user. Code was captured but not exchanged.");
    });

    // Step 3 Confirmation -> Perform Token Exchange & Transition to Step 4 Pre-Flight
    confirmTokenExchangeBtn?.addEventListener('click', async () => {
        document.getElementById('codeModal')?.classList.remove('active');
        
        log("Proceeding to Step 3: Exchanging authorization code for Access Token...");

        try {
            const tokenData = await exchangeCodeForToken();
            log("Success! Access Token acquired.");

            // Store acquired token globally
            currentAccessToken = tokenData.access_token;

            // Extract context patient ID returned by Epic
            const patientId = tokenData.patient || '';
            if (patientId) {
                log(`Context Patient ID acquired: ${patientId}`);
            }

            // Populate Step 4 FHIR Inspection Modal
            const fhirBaseUrl = getVal('m-aud') || CONFIG.FHIR_BASE_URL;
            setVal('m-bearer-token', currentAccessToken);
            setVal('m-fhir-patient-id', patientId);

            // Construct default target FHIR endpoint URL
            const defaultEndpoint = patientId 
                ? `${fhirBaseUrl}/Appointment?patient=${patientId}` 
                : `${fhirBaseUrl}/Patient`;
            setVal('m-fhir-endpoint', defaultEndpoint);

            // Function to render raw HTTP GET Request preview for Step 4
            function updateFhirGetPreview() {
                const targetUrl = getVal('m-fhir-endpoint');
                const token = getVal('m-bearer-token');

                const rawHttpGetText = 
`GET ${targetUrl} HTTP/1.1
Host: fhir.epic.com
Authorization: Bearer ${token}
Accept: application/fhir+json`;

                const previewEl = document.getElementById('m-fhir-get-preview');
                if (previewEl) previewEl.textContent = rawHttpGetText;
            }

            // Attach dynamic typing listeners to Step 4 inputs
            ['m-fhir-endpoint', 'm-fhir-patient-id', 'm-bearer-token'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', updateFhirGetPreview);
            });

            updateFhirGetPreview();

            // Open Step 4 Modal and PAUSE
            const fhirModal = document.getElementById('fhirModal');
            if (fhirModal) {
                fhirModal.classList.add('active');
                log("PAUSED at Step 4: Inspect Bearer Token and outgoing GET request prior to fetching FHIR resources.");
            }
        } catch (err) {
            log(`Token Exchange Failed: ${err.message}`);
        }
    });

    // Step 4 Modal -> Abort
    cancelFhirBtn?.addEventListener('click', () => {
        document.getElementById('fhirModal')?.classList.remove('active');
        log("FHIR query aborted by user.");
    });

    // Step 4 Modal -> Execute Final FHIR API GET Request
    confirmFhirFetchBtn?.addEventListener('click', async () => {
        document.getElementById('fhirModal')?.classList.remove('active');
        
        const targetEndpoint = getVal('m-fhir-endpoint');
        const token = getVal('m-bearer-token');

        log(`Sending Authorized FHIR Request to ${targetEndpoint}...`);
        fetchFhirResource(targetEndpoint, token);
    });
});

// --- 3. LISTEN FOR AUTH CODE & INTERCEPT AT STEP 2/3 ---
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    if (event.data && event.data.type === 'AUTH_CODE') {
        const { code, state } = event.data;
        const savedState = sessionStorage.getItem('fhir_state');

        // 1. Verify CSRF State
        if (!state || state !== savedState) {
            log("Security Error: State mismatch detected. Request aborted.");
            alert("Security Error: State mismatch detected. Request aborted.");
            return;
        }

        log("Step 2 Complete: Authorization Code captured successfully!");

        capturedAuthCode = code;

        // 2. Extract values from Step 1 config/edits
        const redirectUri = document.getElementById('m-redirect-uri')?.value || CONFIG.REDIRECT_URI;
        const clientId = document.getElementById('m-client-id')?.value || CONFIG.CLIENT_ID;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };

        // 3. Populate Step 3 Modal Inputs
        setVal('m-returned-state', state);
        setVal('m-token-endpoint', CONFIG.TOKEN_URL);
        setVal('m-grant-type', 'authorization_code');
        setVal('m-auth-code', code);
        setVal('m-step3-redirect-uri', redirectUri);
        setVal('m-step3-client-id', clientId);

        // 4. Live update function for HTTP POST request preview box
        function updatePostPreview() {
            const endpoint = document.getElementById('m-token-endpoint')?.value || CONFIG.TOKEN_URL;
            const bodyParams = new URLSearchParams({
                grant_type: document.getElementById('m-grant-type')?.value || 'authorization_code',
                code: document.getElementById('m-auth-code')?.value || '',
                redirect_uri: document.getElementById('m-step3-redirect-uri')?.value || '',
                client_id: document.getElementById('m-step3-client-id')?.value || ''
            });

            const rawHttpPostText = 
`POST ${endpoint} HTTP/1.1
Host: fhir.epic.com
Content-Type: application/x-www-form-urlencoded
Accept: application/json

${bodyParams.toString()}`;

            const previewEl = document.getElementById('m-post-preview');
            if (previewEl) previewEl.textContent = rawHttpPostText;
        }

        // Attach listeners to Step 3 fields
        ['m-token-endpoint', 'm-grant-type', 'm-auth-code', 'm-step3-redirect-uri', 'm-step3-client-id'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', updatePostPreview);
        });

        updatePostPreview();

        // 5. Open Step 2/3 Inspection Modal & PAUSE
        const codeModal = document.getElementById('codeModal');
        if (codeModal) {
            codeModal.classList.add('active');
            log("Authorization code displayed for inspection. Review token request payload before proceeding.");
        }
    }
});

// --- 4. STEP 3 & STEP 4 API CALLS ---
async function exchangeCodeForToken() {
    // Read exact user-edited values from Step 3 Modal
    const tokenEndpoint = document.getElementById('m-token-endpoint')?.value || CONFIG.TOKEN_URL;
    const grantType = document.getElementById('m-grant-type')?.value || 'authorization_code';
    const code = document.getElementById('m-auth-code')?.value || capturedAuthCode;
    const redirectUri = document.getElementById('m-step3-redirect-uri')?.value || CONFIG.REDIRECT_URI;
    const clientId = document.getElementById('m-step3-client-id')?.value || CONFIG.CLIENT_ID;

    const bodyParams = new URLSearchParams({
        grant_type: grantType,
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId
    });

    const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
        },
        body: bodyParams.toString()
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody}`);
    }

    return await response.json();
}

async function fetchFhirResource(targetUrl, token) {
    try {
        const response = await fetch(targetUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/fhir+json'
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        const data = await response.json();
        log("Success! FHIR resource data retrieved.");
        
        const container = document.getElementById('fhirData');
        if (container) {
            container.textContent = JSON.stringify(data, null, 2);
        }
    } catch (err) {
        log(`Error fetching FHIR resource: ${err.message}`);
    }
}

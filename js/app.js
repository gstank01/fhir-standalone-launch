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

// --- 1. CALLBACK HANDLER (Runs inside Pop-up when redirected back) ---
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

    // Safe DOM value getters/setters
    const getVal = (id) => document.getElementById(id)?.value || '';
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    // Helper to update Preview GET Request URL live
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
            // Save state in case the user edited it manually
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

    // Step 2 Modal -> Abort Exchange
    cancelCodeBtn?.addEventListener('click', () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Token exchange aborted by user. Code was captured but not exchanged.");
    });

    // Step 2 Modal -> Confirm Exchange -> Proceed to Step 3 (Token Exchange)
    confirmTokenExchangeBtn?.addEventListener('click', async () => {
        document.getElementById('codeModal')?.classList.remove('active');
        
        log("Proceeding to Step 3: Exchanging authorization code for Access Token...");

        try {
            const tokenData = await exchangeCodeForToken(capturedAuthCode);
            log("Success! Access Token acquired.");

            log("Fetching Appointment resources from FHIR server...");
            fetchAppointments(tokenData.access_token);
        } catch (err) {
            log(`Token Exchange Failed: ${err.message}`);
        }
    });
});

// --- 3. LISTEN FOR AUTH CODE & INTERCEPT BEFORE STEP 3 ---
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    if (event.data.type === 'AUTH_CODE') {
        const { code, state } = event.data;
        const savedState = sessionStorage.getItem('fhir_state');

        // 1. Verify CSRF State
        if (!state || state !== savedState) {
            log("Security Error: State mismatch detected. Request aborted.");
            alert("Security Error: State mismatch detected. Request aborted.");
            return;
        }

        log("Step 2 Complete: Authorization Code captured successfully!");

        // 2. Store code temporarily and populate Step 2 modal
        capturedAuthCode = code;
        
        const returnedStateInput = document.getElementById('m-returned-state');
        const authCodeInput = document.getElementById('m-auth-code');
        const codeModal = document.getElementById('codeModal');

        if (returnedStateInput) returnedStateInput.value = state;
        if (authCodeInput) authCodeInput.value = code;

        // 3. Open Code Inspection Modal (Pauses before Step 3)
        if (codeModal) {
            codeModal.classList.add('active');
            log("Authorization code displayed for inspection. Awaiting manual trigger to exchange for token.");
        }
    }
});

// --- 4. STEP 3 API CALLS ---
async function exchangeCodeForToken(authCode) {
    const clientId = document.getElementById('m-client-id')?.value || CONFIG.CLIENT_ID;
    const redirectUri = document.getElementById('m-redirect-uri')?.value || CONFIG.REDIRECT_URI;

    const bodyParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: clientId
    });

    const response = await fetch(CONFIG.TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: bodyParams
    });

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${errBody}`);
    }

    return await response.json();
}

async function fetchAppointments(token) {
    const fhirBaseUrl = document.getElementById('m-aud')?.value || CONFIG.FHIR_BASE_URL;

    try {
        const response = await fetch(`${fhirBaseUrl}/Appointment?_count=3`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/fhir+json'
            }
        });

        if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
        }

        const data = await response.json();
        log("Success! Appointments retrieved.");
        document.getElementById('fhirData').textContent = JSON.stringify(data, null, 2);
    } catch (err) {
        log(`Error fetching FHIR data: ${err.message}`);
    }
}

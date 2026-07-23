// --- RANDOM STRING GENERATOR (For State) ---
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

// --- 1. CALLBACK HANDLER (Runs inside the Popup when redirected back) ---
(function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const returnedState = urlParams.get('state');

    if (code) {
        if (window.opener) {
            // Send BOTH code and returnedState back to the main window for validation
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
let pendingAuthUrl = '';

document.addEventListener('DOMContentLoaded', () => {
    const launchBtn = document.getElementById('launchBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const confirmLaunchBtn = document.getElementById('confirmLaunchBtn');

    // Helper function to build URL live from input fields safely
    function updatePreviewUrl() {
        const getVal = (id) => document.getElementById(id)?.value || '';
        
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

    // Bind real-time input change listeners
    document.querySelectorAll('.param-input').forEach(input => {
        input.addEventListener('input', updatePreviewUrl);
    });

    // Trigger Pre-Flight Screen
    launchBtn?.addEventListener('click', () => {
        try {
            log("Generating authorization parameters...");

            const state = generateRandomString(32);
            sessionStorage.setItem('fhir_state', state);

            // Safely set inputs
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.value = val;
            };

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
                log("Error: #preflightModal element not found in HTML.");
            }
        } catch (err) {
            log(`JavaScript Error: ${err.message}`);
        }
    });

    // Cancel Button
    cancelModalBtn?.addEventListener('click', () => {
        document.getElementById('preflightModal')?.classList.remove('active');
        log("Launch canceled by user.");
    });

    // Confirm & Open Popup
    confirmLaunchBtn?.addEventListener('click', () => {
        const currentState = document.getElementById('m-state')?.value || '';
        sessionStorage.setItem('fhir_state', currentState);

        updatePreviewUrl();

        document.getElementById('preflightModal')?.classList.remove('active');
        log("Opening secure authentication pop-up...");
        window.open(pendingAuthUrl, 'FHIR Auth', 'width=600,height=700');
    });
});

// --- 3. LISTEN FOR AUTH CODE & EXCHANGE FOR TOKEN ---
window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin) return;

    if (event.data.type === 'AUTH_CODE') {
        const { code, state } = event.data;
        const savedState = sessionStorage.getItem('fhir_state');

        // State verification happens HERE in the parent window!
        if (!state || state !== savedState) {
            log("Security Error: State mismatch detected. Request aborted.");
            alert("Security Error: State mismatch detected. Request aborted.");
            return;
        }

        log("Authorization code received and state verified!");
        log("Exchanging authorization code for Access Token...");

        try {
            const tokenData = await exchangeCodeForToken(code);
            log("Access Token acquired!");

            log("Fetching Appointment resources from FHIR server...");
            fetchAppointments(tokenData.access_token);
        } catch (err) {
            log(`Token Exchange Failed: ${err.message}`);
        }
    }
});

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

// --- PKCE & CRYPTO HELPER FUNCTIONS ---
function generateRandomString(length = 64) {
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
        const savedState = sessionStorage.getItem('fhir_state');

        if (returnedState && returnedState === savedState) {
            if (window.opener) {
                window.opener.postMessage({ type: 'AUTH_CODE', code: code }, window.location.origin);
                window.close();
            }
        } else {
            alert("Security Error: State mismatch detected. Request aborted.");
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

    // Trigger Pre-Flight Screen
    launchBtn.addEventListener('click', () => {
        log("Generating authorization parameters...");

        const state = generateRandomString(32);

        // Store state in Session Storage
        sessionStorage.setItem('fhir_state', state);

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: CONFIG.CLIENT_ID,
            redirect_uri: CONFIG.REDIRECT_URI,
            state: state,
            scope: CONFIG.SCOPES,
            aud: CONFIG.FHIR_BASE_URL
        });

        pendingAuthUrl = `${CONFIG.AUTH_URL}?${params.toString()}`;

        // Populate Modal Fields
        document.getElementById('m-endpoint').textContent = CONFIG.AUTH_URL;
        document.getElementById('m-client-id').textContent = CONFIG.CLIENT_ID;
        document.getElementById('m-redirect-uri').textContent = CONFIG.REDIRECT_URI;
        document.getElementById('m-aud').textContent = CONFIG.FHIR_BASE_URL;
        document.getElementById('m-state').textContent = state;
        document.getElementById('m-pkce').textContent = 'Excluded (Not Required)';
        document.getElementById('m-scope').textContent = CONFIG.SCOPES;
        document.getElementById('m-full-url').textContent = pendingAuthUrl;

        // Display Modal
        document.getElementById('preflightModal').classList.add('active');
        log("Pre-flight screen displayed.");
    });

    // Cancel Button
    cancelModalBtn.addEventListener('click', () => {
        document.getElementById('preflightModal').classList.remove('active');
        log("Launch canceled by user.");
    });

    // Confirm & Open Popup
    confirmLaunchBtn.addEventListener('click', () => {
        document.getElementById('preflightModal').classList.remove('active');
        log("Opening secure authentication pop-up...");
        window.open(pendingAuthUrl, 'FHIR Auth', 'width=600,height=700');
    });
});

// --- 3. LISTEN FOR AUTH CODE & EXCHANGE FOR TOKEN ---
window.addEventListener('message', async (event) => {
    if (event.origin !== window.location.origin) return;

    if (event.data.type === 'AUTH_CODE') {
        log("Authorization code received!");
        log("Exchanging authorization code for Access Token...");

        try {
            const tokenData = await exchangeCodeForToken(event.data.code);
            log("Access Token acquired!");

            log("Fetching Appointment resources from FHIR server...");
            fetchAppointments(tokenData.access_token);
        } catch (err) {
            log(`Token Exchange Failed: ${err.message}`);
        }
    }
});

async function exchangeCodeForToken(authCode) {
    const bodyParams = new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: CONFIG.REDIRECT_URI,
        client_id: CONFIG.CLIENT_ID
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
    try {
        const response = await fetch(`${CONFIG.FHIR_BASE_URL}/Appointment?_count=3`, {
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

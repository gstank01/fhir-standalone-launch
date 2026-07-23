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

    // Helper function to build URL live from input fields
    function updatePreviewUrl() {
        const endpoint = document.getElementById('m-endpoint').value;
        
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: document.getElementById('m-client-id').value,
            redirect_uri: document.getElementById('m-redirect-uri').value,
            state: document.getElementById('m-state').value,
            scope: document.getElementById('m-scope').value,
            aud: document.getElementById('m-aud').value
        });

        pendingAuthUrl = `${endpoint}?${params.toString()}`;
        document.getElementById('m-full-url').textContent = pendingAuthUrl;
    }

    // Bind real-time input change listeners so URL preview updates dynamically
    document.querySelectorAll('.param-input').forEach(input => {
        input.addEventListener('input', updatePreviewUrl);
    });

    // Trigger Pre-Flight Screen
    launchBtn.addEventListener('click', () => {
        log("Generating authorization parameters...");

        const state = generateRandomString(32);
        sessionStorage.setItem('fhir_state', state);

        // Populate editable input fields with default config values
        document.getElementById('m-endpoint').value = CONFIG.AUTH_URL;
        document.getElementById('m-client-id').value = CONFIG.CLIENT_ID;
        document.getElementById('m-redirect-uri').value = CONFIG.REDIRECT_URI;
        document.getElementById('m-aud').value = CONFIG.FHIR_BASE_URL;
        document.getElementById('m-state').value = state;
        document.getElementById('m-scope').value = CONFIG.SCOPES;

        // Render initial URL preview
        updatePreviewUrl();

        // Display Modal
        document.getElementById('preflightModal').classList.add('active');
        log("Pre-flight screen displayed. Edit fields as needed.");
    });

    // Cancel Button
    cancelModalBtn.addEventListener('click', () => {
        document.getElementById('preflightModal').classList.remove('active');
        log("Launch canceled by user.");
    });

    // Confirm & Open Popup
    confirmLaunchBtn.addEventListener('click', () => {
        // Sync sessionStorage in case the user manually edited the 'state' input
        const currentState = document.getElementById('m-state').value;
        sessionStorage.setItem('fhir_state', currentState);

        // Final URL sync
        updatePreviewUrl();

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
    // Uses the edited values from DOM if changed, otherwise falls back to CONFIG
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

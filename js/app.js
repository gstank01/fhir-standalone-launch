// --- 1. CALLBACK HANDLER (Runs inside Pop-up when redirected back from EHR) ---
(function handleCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const returnedState = urlParams.get('state');

    if (code && window.opener) {
        window.opener.postMessage({ 
            type: 'AUTH_CODE', 
            code: code, 
            state: returnedState 
        }, window.location.origin);
        window.close();
    }
})();

// --- 2. MAIN APPLICATION LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
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

        const pendingAuthUrl = `${endpoint}?${params.toString()}`;
        AuthStore.setPendingAuthUrl(pendingAuthUrl);

        const fullUrlEl = document.getElementById('m-full-url');
        if (fullUrlEl) fullUrlEl.textContent = pendingAuthUrl;
    }

    document.querySelectorAll('.param-input').forEach(input => {
        input.addEventListener('input', updatePreviewUrl);
    });

    // STEP 1: Trigger Button -> Open Pre-Flight Modal
    launchBtn?.addEventListener('click', () => {
        try {
            log("Generating authorization parameters...");

            const state = generateRandomString(32);
            AuthStore.setState(state);

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
            }
        } catch (err) {
            log(`RUNTIME ERROR: ${err.message}`);
        }
    });

    cancelModalBtn?.addEventListener('click', () => {
        document.getElementById('preflightModal')?.classList.remove('active');
        log("Launch canceled by user.");
    });

    confirmLaunchBtn?.addEventListener('click', () => {
        try {
            const currentState = getVal('m-state');
            AuthStore.setState(currentState);
            updatePreviewUrl();

            document.getElementById('preflightModal')?.classList.remove('active');
            log("Opening secure authentication pop-up...");
            
            const authUrl = AuthStore.getPendingAuthUrl();
            window.open(authUrl, 'FHIR Auth', 'width=600,height=700');
        } catch (err) {
            log(`LAUNCH ERROR: ${err.message}`);
        }
    });

    cancelCodeBtn?.addEventListener('click', () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Token exchange aborted by user.");
    });

    // STEP 3: Confirm Token Exchange -> Open Step 4 Modal
    confirmTokenExchangeBtn?.addEventListener('click', async () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Proceeding to Step 3: Exchanging authorization code for Access Token...");

        try {
            const tokenData = await exchangeCodeForToken();
            log("Success! Access Token acquired.");

            // Store in AuthStore & populate dynamic input element
            AuthStore.setAccessToken(tokenData.access_token);
            setVal('m-bearer-token', tokenData.access_token);

            // Dynamically updates Stage 1 Preview using Patient?identifier={id}
            function updatePatientSearchPreview() {
                const fhirBaseUrl = getVal('m-aud') || CONFIG.FHIR_BASE_URL;
                const identifier = getVal('m-search-identifier');

                const targetUrl = `${fhirBaseUrl}/Patient?identifier=${encodeURIComponent(identifier)}`;
                const token = getVal('m-bearer-token');

                const rawHttpGetText = 
`GET ${targetUrl} HTTP/1.1
Host: fhir.epic.com
Authorization: Bearer ${token}
Accept: application/fhir+json`;

                const previewEl = document.getElementById('m-fhir-patient-search-preview');
                if (previewEl) previewEl.textContent = rawHttpGetText;
            }

            // Attach dynamic typing listeners
            ['m-search-identifier', 'm-bearer-token'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', updatePatientSearchPreview);
            });

            updatePatientSearchPreview();

            // Open Step 4 Modal & PAUSE
            const fhirModal = document.getElementById('fhirModal');
            if (fhirModal) {
                fhirModal.classList.add('active');
                log("PAUSED at Step 4: Review Patient Identifier lookup parameters and Bearer token.");
            }
        } catch (err) {
            log(`Token Exchange Failed: ${err.message}`);
        }
    });

    cancelFhirBtn?.addEventListener('click', () => {
        document.getElementById('fhirModal')?.classList.remove('active');
        log("FHIR query aborted by user.");
    });

    // STEP 4: Execute Patient Search by Identifier -> Extract Patient ID -> Fetch Appointments
    confirmFhirFetchBtn?.addEventListener('click', async () => {
        document.getElementById('fhirModal')?.classList.remove('active');
        
        const fhirBaseUrl = getVal('m-aud') || CONFIG.FHIR_BASE_URL;
        const token = getVal('m-bearer-token') || AuthStore.getAccessToken();
        const identifier = getVal('m-search-identifier');

        if (!identifier) {
            log("ERROR: Patient Identifier is required for lookup.");
            return;
        }

        const patientSearchUrl = `${fhirBaseUrl}/Patient?identifier=${encodeURIComponent(identifier)}`;

        try {
            // Stage 1: Perform Patient Search
            log(`Stage 1: Searching for Patient via ${patientSearchUrl}...`);
            const bundle = await fetchFhirResource(patientSearchUrl, token);

            if (!bundle.entry || bundle.entry.length === 0) {
                throw new Error(`No patient found matching identifier '${identifier}'.`);
            }

            // Stage 2: Extract FHIR Patient ID from Bundle entry
            const patientResource = bundle.entry[0].resource;
            const patientFhirId = patientResource.id;
            const patientNameText = patientResource.name?.[0]?.text || "Patient";
            
            log(`Success! Patient found: ${patientNameText} (Extracted FHIR ID: ${patientFhirId})`);

            // Execute Appointment Query with Extracted Patient ID
            const appointmentUrl = `${fhirBaseUrl}/Appointment?patient=${patientFhirId}`;
            log(`Stage 2: Fetching Appointments using extracted FHIR ID via ${appointmentUrl}...`);
            
            const appointmentData = await fetchFhirResource(appointmentUrl, token);
            log("Success! Appointment resources retrieved from Epic.");

            const container = document.getElementById('fhirData');
            if (container) {
                container.textContent = JSON.stringify(appointmentData, null, 2);
            }
        } catch (err) {
            log(`Error during FHIR workflow: ${err.message}`);
        }
    });
});

// --- 3. LISTEN FOR AUTH CODE & INTERCEPT AT STEP 2/3 ---
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    if (event.data && event.data.type === 'AUTH_CODE') {
        const { code, state } = event.data;
        const savedState = AuthStore.getState();

        if (!state || state !== savedState) {
            log("Security Error: CSRF State mismatch detected! Request aborted.");
            alert("Security Error: CSRF State mismatch detected.");
            AuthStore.clearAll();
            return;
        }

        log("Step 2 Complete: Authorization Code captured successfully!");

        AuthStore.setAuthCode(code);

        const redirectUri = document.getElementById('m-redirect-uri')?.value || CONFIG.REDIRECT_URI;
        const clientId = document.getElementById('m-client-id')?.value || CONFIG.CLIENT_ID;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };

        setVal('m-returned-state', state);
        setVal('m-token-endpoint', CONFIG.TOKEN_URL);
        setVal('m-grant-type', 'authorization_code');
        setVal('m-auth-code', code);
        setVal('m-step3-redirect-uri', redirectUri);
        setVal('m-step3-client-id', clientId);

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

        ['m-token-endpoint', 'm-grant-type', 'm-auth-code', 'm-step3-redirect-uri', 'm-step3-client-id'].forEach((id) => {
            document.getElementById(id)?.addEventListener('input', updatePostPreview);
        });

        updatePostPreview();

        const codeModal = document.getElementById('codeModal');
        if (codeModal) {
            codeModal.classList.add('active');
            log("PAUSED before Step 3. Review token exchange payload parameters.");
        }
    }
});

// --- 4. STEP 3 & STEP 4 API CALLS ---
async function exchangeCodeForToken() {
    const tokenEndpoint = document.getElementById('m-token-endpoint')?.value || CONFIG.TOKEN_URL;
    const grantType = document.getElementById('m-grant-type')?.value || 'authorization_code';
    const code = document.getElementById('m-auth-code')?.value || AuthStore.getAuthCode();
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
    const response = await fetch(targetUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json, application/fhir+json'
        }
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    return await response.json();
}

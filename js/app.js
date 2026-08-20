// --- MAIN APPLICATION LOGIC ---
document.addEventListener('DOMContentLoaded', () => { // Wait for HTML document to load completely
    if (typeof CONFIG === 'undefined') { // Check if config.js is loaded
        log("CRITICAL ERROR: 'CONFIG' is not defined. Ensure js/config.js is loaded before js/app.js in index.html!");
        return;
    }

    // DOM Element References
    const launchBtn = document.getElementById('launchBtn');
    const worklistModal = document.getElementById('worklistModal');
    const cancelWorklistBtn = document.getElementById('cancelWorklistBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const confirmLaunchBtn = document.getElementById('confirmLaunchBtn');
    const cancelCodeBtn = document.getElementById('cancelCodeBtn');
    const confirmTokenExchangeBtn = document.getElementById('confirmTokenExchangeBtn');
    const cancelFhirBtn = document.getElementById('cancelFhirBtn');
    const confirmPatientSearchBtn = document.getElementById('confirmPatientSearchBtn');
    const confirmAppointmentFetchBtn = document.getElementById('confirmAppointmentFetchBtn');

    // Initialise the referral UI module if available
    if (typeof initReferralUI === 'function') {
        initReferralUI();
    }
    
    // DOM Value Helper Functions
    const getVal = (id) => document.getElementById(id)?.value || '';
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    // --- RIS PATIENT WORKLIST INTEGRATION ---
    if (typeof PatientStore !== 'undefined') {
        PatientStore.init();

        function renderWorklistUI() {
            const selectEl = document.getElementById('worklistSelect');
            const cardEl = document.getElementById('patientContextCard');
            if (!selectEl) return;

            const patients = PatientStore.getAllPatients();
            const activePatient = PatientStore.getActivePatient();

            // Populate dropdown menu
            selectEl.innerHTML = '';
            patients.forEach(patient => {
                const opt = document.createElement('option');
                opt.value = patient.id;
                opt.textContent = `${patient.name} (${patient.identifier}) - ${patient.modality}`;
                if (patient.id === activePatient.id) opt.selected = true;
                selectEl.appendChild(opt);
            });

            // Populate summary card
            if (cardEl && activePatient) {
                cardEl.innerHTML = '';
                
                const h3 = document.createElement('h3');
                h3.textContent = activePatient.name;
                cardEl.appendChild(h3);

                const pMRN = document.createElement('p');
                pMRN.textContent = `Identifier / MRN: ${activePatient.identifier}`;
                cardEl.appendChild(pMRN);

                const pModality = document.createElement('p');
                pModality.textContent = `Study: ${activePatient.modality} (${activePatient.studyStatus})`;
                cardEl.appendChild(pModality);
            }
        }

        // --- WORKLIST MODAL TOGGLE & EVENT LISTENERS ---

        // 1. Open ONLY Worklist Modal when "GET Appointments" is clicked
        launchBtn?.addEventListener('click', () => {
            if (worklistModal) {
                worklistModal.classList.add('active'); // Opens the pop-up modal
                log("Opened patient worklist modal.");
            }
        });

        // 2. Close Worklist Modal when "Cancel" is clicked
        cancelWorklistBtn?.addEventListener('click', () => {
            if (worklistModal) {
                worklistModal.classList.remove('active'); // Hides the pop-up modal
                log("Worklist modal closed.");
            }
        });

        // 3. Confirm selection -> Hide Worklist Modal & Launch Step 1 (Pre-flight Modal)
        const confirmAppointmentsBtn = document.getElementById('confirmAppointmentsBtn');
        confirmAppointmentsBtn?.addEventListener('click', async () => {
            if (worklistModal) {
                worklistModal.classList.remove('active'); // Hide worklist modal
            }

            const activePatient = PatientStore.getActivePatient();
            if (!activePatient) {
                alert("No active patient selected.");
                return;
            }

            log(`Confirmed worklist selection for: ${activePatient.name} (MRN: ${activePatient.identifier})`);

            // --- TRIGGER STEP 1 (Pre-Flight Modal) ---
            try {
                AuthStore.setPatientContext(activePatient);
                log(`Bound patient context: ${activePatient.name} (MRN: ${activePatient.identifier})`);

                log("Generating authorization parameters...");
                const state = generateRandomString(32);
                AuthStore.setState(state);

                // Set inputs for Auth Code Request
                setVal('m-endpoint', CONFIG.AUTH_URL);
                setVal('m-client-id', CONFIG.CLIENT_ID);
                setVal('m-redirect-uri', CONFIG.REDIRECT_URI);
                setVal('m-aud', CONFIG.FHIR_BASE_URL);
                setVal('m-state', state);
                setVal('m-scope', CONFIG.SCOPES);

                updatePreviewUrl();

                // Display Step 1 Modal
                const preflightModal = document.getElementById('preflightModal');
                if (preflightModal) {
                    preflightModal.classList.add('active');
                    log("Pre-flight screen displayed. Edit fields as needed.");
                }
            } catch (err) {
                log(`RUNTIME ERROR: ${err.message}`);
            }
        });

        // Change active patient on dropdown selection
        document.getElementById('worklistSelect')?.addEventListener('change', (e) => {
            PatientStore.setActivePatientId(e.target.value);
            renderWorklistUI();
            log(`Active RIS Patient switched to: ${PatientStore.getActivePatient().name}`);
        });

        renderWorklistUI();
    }

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

    // Update preview URL if parameters are manually changed
    document.querySelectorAll('#preflightModal .param-input').forEach(input => {
        input.addEventListener('input', updatePreviewUrl);
    });

    // Cancel pre-flight execution
    cancelModalBtn?.addEventListener('click', () => {
        document.getElementById('preflightModal')?.classList.remove('active');
        log("Launch canceled by user.");
    });

    // Confirm launch -> Open EHR authentication pop-up window
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

    // Cancel before token exchange
    cancelCodeBtn?.addEventListener('click', () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Token exchange aborted by user.");
    });

    // --- Listen for AUTH Code Callback from EHR Pop-up Window ---
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

            setVal('m-returned-state', state);
            setVal('m-token-endpoint', CONFIG.TOKEN_URL);
            setVal('m-grant-type', 'authorization_code');
            setVal('m-auth-code', code);
            setVal('m-step3-redirect-uri', redirectUri);
            setVal('m-step3-client-id', clientId);

            // Update HTTP POST Preview
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

    // --- Token Exchange Function ---
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

    // Confirm Token Exchange & Open Step 4 Modal
    confirmTokenExchangeBtn?.addEventListener('click', async () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Proceeding to Step 3: Exchanging authorization code for Access Token...");

        try {
            const tokenData = await exchangeCodeForToken();
            log("Success! Access Token acquired.");

            AuthStore.setAccessToken(tokenData.access_token);
            setVal('m-bearer-token', tokenData.access_token);

            const patientContext = AuthStore.getPatientContext() || (typeof PatientStore !== 'undefined' ? PatientStore.getActivePatient() : null);
            if (patientContext) {
                setVal('m-search-name', patientContext.given || patientContext.name || '');
                setVal('m-search-identifier', patientContext.identifier || '');
                log(`Loaded patient context into Step 4: ${patientContext.name} (${patientContext.identifier})`);
            }

            function updatePatientSearchPreview() {
                const fhirBaseUrl = getVal('m-aud') || CONFIG.FHIR_BASE_URL;
                const identifier = getVal('m-search-identifier');
                const token = getVal('m-bearer-token');

                const targetUrl = `${fhirBaseUrl}/Patient?identifier=${encodeURIComponent(identifier)}`;

                const rawHttpGetText = 
`GET ${targetUrl} HTTP/1.1
Host: fhir.epic.com
Authorization: Bearer ${token}
Accept: application/fhir+json`;

                const previewEl = document.getElementById('m-fhir-patient-search-preview');
                if (previewEl) previewEl.textContent = rawHttpGetText;
            }

            ['m-search-identifier', 'm-bearer-token'].forEach(id => {
                document.getElementById(id)?.addEventListener('input', updatePatientSearchPreview);
            });

            updatePatientSearchPreview();

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

    // --- STEP 4 - ACTION 1: Execute Patient Search & Extract Logical FHIR ID ---
    confirmPatientSearchBtn?.addEventListener('click', async () => {
        const fhirBaseUrl = getVal('m-aud') || CONFIG.FHIR_BASE_URL;
        const token = getVal('m-bearer-token') || AuthStore.getAccessToken();
        const identifier = getVal('m-search-identifier');

        if (!identifier) {
            log("ERROR: Patient Identifier is required for lookup.");
            return;
        }

        const patientSearchUrl = `${fhirBaseUrl}/Patient?identifier=${encodeURIComponent(identifier)}`;

        try {
            log(`Stage 1: Searching for Patient via ${patientSearchUrl}...`);
            const bundle = await fetchFhirResource(patientSearchUrl, token);

            if (!bundle.entry || bundle.entry.length === 0) {
                throw new Error(`No patient found matching identifier '${identifier}'.`);
            }

            const patientResource = bundle.entry[0].resource;

            // Open JSON inspection window
            openJsonInspectionWindow("Patient Resource Inspection", patientResource.id, patientResource);
            log("Patient Resource opened in pop-up window. Inspect patientResource.id!");

            let patientFhirId = patientResource.id || '';
            if (patientFhirId.startsWith('Patient/')) {
                patientFhirId = patientFhirId.replace('Patient/', '');
            }

            setVal('m-extracted-patient-id', patientFhirId);

            const patientNameText = patientResource.name?.[0]?.text || "Patient";
            log(`Stage 1 Success: Identified ${patientNameText} (Extracted ID: ${patientFhirId})`);

            // Populate Stage 2 Preview Box
            const appointmentUrl = `${fhirBaseUrl}/Appointment?patient=${encodeURIComponent(patientFhirId)}`;
            const rawApptGet = 
`GET ${appointmentUrl} HTTP/1.1
Host: fhir.epic.com
Authorization: Bearer ${token}
Accept: application/fhir+json`;

            const apptPreviewEl = document.getElementById('m-fhir-appointment-preview');
            if (apptPreviewEl) apptPreviewEl.textContent = rawApptGet;

            if (confirmAppointmentFetchBtn) {
                confirmAppointmentFetchBtn.disabled = false;
            }
            log("PAUSED: Verify Patient ID in pop-up window, then click '2. Fetch Appointments'.");
        } catch (err) {
            log(`Patient Search Error: ${err.message}`);
        }
    });

    // --- STEP 4 - ACTION 2: Fetch Appointments ---
    confirmAppointmentFetchBtn?.addEventListener('click', async () => {
        document.getElementById('fhirModal')?.classList.remove('active');

        const fhirBaseUrl = getVal('m-aud') || CONFIG.FHIR_BASE_URL;
        const token = getVal('m-bearer-token') || AuthStore.getAccessToken();
        const patientFhirId = getVal('m-extracted-patient-id');

        if (!patientFhirId) {
            log("ERROR: No extracted FHIR Patient ID found. Run Stage 1 search first.");
            return;
        }

        const appointmentUrl = `${fhirBaseUrl}/Appointment?patient=${encodeURIComponent(patientFhirId)}`;

        try {
            log(`Stage 2: Fetching Appointments via ${appointmentUrl}...`);
            const appointmentData = await fetchFhirResource(appointmentUrl, token);
            log("Success! Appointment resources retrieved from Epic.");

            const container = document.getElementById('fhirData');
            if (container) {
                container.textContent = JSON.stringify(appointmentData, null, 2);
            }
        } catch (err) {
            log(`Error fetching appointments: ${err.message}`);
        }
    });
});

// --- HELPER FUNCTION: Fetch FHIR Resource ---
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

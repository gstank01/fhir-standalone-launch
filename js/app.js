// ---MAIN APPLICATION LOGIC ---
document.addEventListener('DOMContentLoaded', () => { // Wait for the HTML document to be fully loaded and parsed before running code
    if (typeof CONFIG === 'undefined') { //check if config.js is defined
        log("CRITICAL ERROR: 'CONFIG' is not defined. Ensure js/config.js is loaded before js/app.js in index.html!");
        return;
    }

    
    const launchBtn = document.getElementById('launchBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const confirmLaunchBtn = document.getElementById('confirmLaunchBtn');
    const cancelCodeBtn = document.getElementById('cancelCodeBtn');
    const confirmTokenExchangeBtn = document.getElementById('confirmTokenExchangeBtn');
    const cancelFhirBtn = document.getElementById('cancelFhirBtn');
    const confirmPatientSearchBtn = document.getElementById('confirmPatientSearchBtn');
    const confirmAppointmentFetchBtn = document.getElementById('confirmAppointmentFetchBtn');

    // Initialize the referral UI module
    if (typeof initReferralUI === 'function') {
        initReferralUI();
    }
    
    // ---???TO MOVED TO utils.js---
    const getVal = (id) => document.getElementById(id)?.value || ''; //Look up the element in the DOM tree by its ID (the IDs that were assigned in the HTML)
    const setVal = (id, val) => {
        //Look up the target element in the DOM tree
        const el = document.getElementById(id);
        //Verify that the element actually exists on the current page
        if (el) el.value = val || '';
    };

    // --- RIS PATIENT WORKLIST INTEGRATION ---
    if (typeof PatientStore !== 'undefined') { //check if patient store exist
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

        const pendingAuthUrl = `${endpoint}?${params.toString()}`; //construct the URL
        AuthStore.setPendingAuthUrl(pendingAuthUrl);//Store to the browser session

        const fullUrlEl = document.getElementById('m-full-url');
        if (fullUrlEl) fullUrlEl.textContent = pendingAuthUrl;//SIDE NOTE - in JS if and IF statemnt has one single line inside it, curly braces {} can be omited.
    }

    //update the URL if any of the parametres are manually updated
    document.querySelectorAll('#preflightModal .param-input').forEach(input => {
        input.addEventListener('input', updatePreviewUrl);
    });

    //  Trigger Button -> Save Patient Context & Open Pre-Flight Modal
    launchBtn?.addEventListener('click', () => {
        try {
            //-- Retrieve active patient from RIS Store and save context to session
            if (typeof PatientStore !== 'undefined') {
                const activePatient = PatientStore.getActivePatient();
                AuthStore.setPatientContext(activePatient);
                log(`Bound patient context: ${activePatient.name} (MRN: ${activePatient.identifier})`);
            }

            log("Generating authorization parameters...");

            //Call the generateRandomString() function to generate the unique state
            const state = generateRandomString(32);
            AuthStore.setState(state);

            //set the Auth Code request input parametres
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

    //set the cancell button, to cancel before the execution of the code exchange
    cancelModalBtn?.addEventListener('click', () => {
        document.getElementById('preflightModal')?.classList.remove('active');
        log("Launch canceled by user.");
    });

    //confirm exchange
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

    //set cancel button to cancel before token exchange 
    cancelCodeBtn?.addEventListener('click', () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Token exchange aborted by user.");
    });

    // --- Listen for AUTH code ---
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;

    //check if the state is a match
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

        //save the auth code in sessionStorage
        AuthStore.setAuthCode(code);

        //set the parametres as constants
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

        //Update the perview URL
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

        //update the preview URL if any of the patametres input changes 
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
    // --- Token exchange ---
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

    // --- API Calls ---
    confirmTokenExchangeBtn?.addEventListener('click', async () => {
        document.getElementById('codeModal')?.classList.remove('active');
        log("Proceeding to Step 3: Exchanging authorization code for Access Token...");

        try {
            const tokenData = await exchangeCodeForToken();
            log("Success! Access Token acquired.");

            // Store in AuthStore & populate dynamic input element
            AuthStore.setAccessToken(tokenData.access_token);
            setVal('m-bearer-token', tokenData.access_token);

            // Auto-fill Step 4 lookup parameters using saved patient context
            const patientContext = AuthStore.getPatientContext() || (typeof PatientStore !== 'undefined' ? PatientStore.getActivePatient() : null);
            if (patientContext) {
                setVal('m-search-name', patientContext.given || patientContext.name || '');
                setVal('m-search-identifier', patientContext.identifier || '');
                log(`Loaded patient context into Step 4: ${patientContext.name} (${patientContext.identifier})`);
            }

            // Dynamically updates Stage 1 Preview using Patient?identifier={id}
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

    // ACTION 1: Execute Patient Search -> Open Window -> Extract ID -> PAUSE
    confirmPatientSearchBtn?.addEventListener('click', async () => {
        const fhirBaseUrl = getVal('m-aud') || CONFIG.FHIR_BASE_URL; //if the field is empty fall back to the config file
        const token = getVal('m-bearer-token') || AuthStore.getAccessToken();//if the field is empty fall back to the AuthStore
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

            // 1. Open JSON inspection pop-up window
            openJsonInspectionWindow("Patient Resource Inspection", patientResource.id, patientResource);
            log("Patient Resource opened in pop-up window. Inspect patientResource.id!");

            // 2. Extract  FHIR ID
            let patientFhirId = patientResource.id || '';
            if (patientFhirId.startsWith('Patient/')) {
                patientFhirId = patientFhirId.replace('Patient/', '');
            }

            setVal('m-extracted-patient-id', patientFhirId);

            const patientNameText = patientResource.name?.[0]?.text || "Patient";
            log(`Stage 1 Success: Identified ${patientNameText} (Extracted ID: ${patientFhirId})`);

            // 3. Populate Stage 2 Preview Box on dashboard
            const appointmentUrl = `${fhirBaseUrl}/Appointment?patient=${encodeURIComponent(patientFhirId)}`;
            const rawApptGet = 
`GET ${appointmentUrl} HTTP/1.1
Host: fhir.epic.com
Authorization: Bearer ${token}
Accept: application/fhir+json`;

            const apptPreviewEl = document.getElementById('m-fhir-appointment-preview');
            if (apptPreviewEl) apptPreviewEl.textContent = rawApptGet;

            // 4. Enable Action 2 Button and PAUSE
            if (confirmAppointmentFetchBtn) {
                confirmAppointmentFetchBtn.disabled = false;
            }
            log("PAUSED: Verify Patient ID in pop-up window, then click '2. Fetch Appointments'.");
        } catch (err) {
            log(`Patient Search Error: ${err.message}`);
        }
    });

    // ACTION 2: Fetch Appointments (Executes ONLY when user clicks Button 2)
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

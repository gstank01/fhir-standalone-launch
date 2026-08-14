// ---MAIN APPLICATION LOGIC ---
document.addEventListener('DOMContentLoaded', () => { 
    if (typeof CONFIG === 'undefined') { 
        log("CRITICAL ERROR: 'CONFIG' is not defined. Ensure js/config.js is loaded before js/app.js in index.html!");
        return;
    }

    if (typeof initReferralUI === 'function') {
        initReferralUI();
    }
    
    // --- 1. DOM Element References ---
    const launchBtn = document.getElementById('launchBtn');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const confirmLaunchBtn = document.getElementById('confirmLaunchBtn');
    const cancelCodeBtn = document.getElementById('cancelCodeBtn');
    const confirmTokenExchangeBtn = document.getElementById('confirmTokenExchangeBtn');
    const cancelFhirBtn = document.getElementById('cancelFhirBtn');
    const confirmPatientSearchBtn = document.getElementById('confirmPatientSearchBtn');
    const confirmAppointmentFetchBtn = document.getElementById('confirmAppointmentFetchBtn');
    
    // Referral Modal Elements
    const btnReferralInfo = document.getElementById('btn-referral-info'); 
    const referralModal = document.getElementById('referralModal');
    const cancelReferralBtn = document.getElementById('cancelReferralBtn');
    const startReferralFetchBtn = document.getElementById('startReferralFetchBtn');
    const referralInput = document.getElementById('referralPatientIdentifier');

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

        // Change active patient on dropdown selection
        document.getElementById('worklistSelect')?.addEventListener('change', (e) => {
            PatientStore.setActivePatientId(e.target.value);
            renderWorklistUI();
            log(`Active RIS Patient switched to: ${PatientStore.getActivePatient().name}`);
        });

        renderWorklistUI();
    }

    // --- SMART ON FHIR LAUNCH & PREVIEW HELPERS ---
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

    document.querySelectorAll('#preflightModal .param-input').forEach(input => {
        input.addEventListener('input', updatePreviewUrl);
    });

    launchBtn?.addEventListener('click', () => {
        try {
            if (typeof PatientStore !== 'undefined') {
                const activePatient = PatientStore.getActivePatient();
                AuthStore.setPatientContext(activePatient);
                log(`Bound patient context: ${activePatient.name} (MRN: ${activePatient.identifier})`);
            }

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

    // --- Listen for AUTH code ---
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
                log("PAUSED at Step 4: Review Patient Identifier lookup parameters and Bearer

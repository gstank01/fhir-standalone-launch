// js/referral.js

function initReferralUI() {
    // 1. Get references to our DOM elements
    const btnReferralInfo = document.getElementById('btn-referral-info');
    const referralModal = document.getElementById('referralModal');
    const cancelReferralBtn = document.getElementById('cancelReferralBtn');
    const startReferralFetchBtn = document.getElementById('startReferralFetchBtn');
    const referralIdentifierInput = document.getElementById('referralPatientIdentifier');

    // Guard clause: If the button doesn't exist on this page, stop running this script.
    if (!btnReferralInfo) return;

    // 2. Show the modal when "Referral info" is clicked
    btnReferralInfo.addEventListener('click', () => {
        if (referralIdentifierInput) {
            referralIdentifierInput.value = ''; // clear out old inputs
        }
        if (referralModal) {
            referralModal.classList.add('active');
        }

        // Auto-focus the input box for better UX
        setTimeout(() => {
            if (referralIdentifierInput) {
                referralIdentifierInput.focus();
            }
        }, 100);
    });

    // 3. Hide the modal on Cancel
    if (cancelReferralBtn && referralModal) {
        cancelReferralBtn.addEventListener('click', () => {
            referralModal.classList.remove('active');
            log("Referral info fetch canceled by user.");
        });
    }

    // 4. When the user clicks "Fetch Data", grab the ID and start the sequence
    if (startReferralFetchBtn && referralIdentifierInput && referralModal) {
        startReferralFetchBtn.addEventListener('click', async () => {
            const identifier = referralIdentifierInput.value.trim();

            if (!identifier) {
                alert('Please enter a patient identifier.');
                return;
            }

            // Close the modal and disable the button to prevent double-clicks
            referralModal.classList.remove('active');
            startReferralFetchBtn.disabled = true;
            startReferralFetchBtn.textContent = "Fetching...";

            log(`[Referral Flow] Starting sequence for identifier: ${identifier}`);

            // Start the API chain and wait for it to finish
            await executeReferralWorkflow(identifier);

            // Re-enable the button when done
            startReferralFetchBtn.disabled = false;
            startReferralFetchBtn.textContent = "Get info";
        });
    }
}

// Master function for the full referral workflow chain
async function executeReferralWorkflow(identifier) {
    try {
        log("--- STARTING API CHAIN VIA VERCEL ---");
        log(`Initiating workflow for identifier: ${identifier}`);

        // Step A & B: Request Access Token from Vercel backend
        log("Step A & B: Requesting Access Token and FHIR URL from Vercel...");
        const tokenResponse = await fetch('/api/getPatient', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ identifier: identifier })
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            throw new Error(tokenData.error || "Failed to acquire token from backend.");
        }

        const accessToken = tokenData.token;
        const fhirUrl = tokenData.fhirUrl || (typeof CONFIG !== 'undefined' ? CONFIG.FHIRURL : '');

        if (!fhirUrl) {
            throw new Error("FHIR base URL is missing. Check your configuration or Vercel environment variables.");
        }

        log("SUCCESS: Access Token and FHIR URL acquired successfully.");

        // Step C: Patient Lookup using Patient?identifier={identifier}
        const patientSearchUrl = `${fhirUrl}/Patient?identifier=${encodeURIComponent(identifier)}`;
        log(`Step C: Fetching Patient -> ${patientSearchUrl}`);

        const patientResponse = await fetch(patientSearchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        const patientBundle = await patientResponse.json();

        if (!patientResponse.ok) {
            throw new Error(`Patient lookup failed: ${JSON.stringify(patientBundle)}`);
        }

        log("SUCCESS: Patient Lookup Bundle Received.");

        // Step D: Extract FHIR ID & Validate Entries
        if (!patientBundle.entry || patientBundle.entry.length === 0) {
            log("WARNING: No matching patient resource found for the given identifier.");
            alert("Patient not found in EHR.");
            return;
        }

        const fhirId = patientBundle.entry[0].resource.id;
        log(`Step D: Extracted logical Patient FHIR ID: ${fhirId}`);

        // Step E: Fetch Encounters using the extracted FHIR ID
        const encounterUrl = `${fhirUrl}/Encounter?patient=${encodeURIComponent(fhirId)}&_include=Encounter:EpisodeOfCare`;
        log(`Step E: Fetching Encounters -> ${encounterUrl}`);

        const encounterResponse = await fetch(encounterUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        const encounterBundle = await encounterResponse.json();

        if (!encounterResponse.ok) {
            throw new Error(`Encounter lookup failed: ${JSON.stringify(encounterBundle)}`);
        }

        log("SUCCESS: Encounter Bundle Received.");
        log("Opening Encounter & Patient Record in inspector window...");

        // Open inspection window passing both bundles and extracted details
        if (typeof openReferralInspectorWindow === 'function') {
            openReferralInspectorWindow(`Encounters & Patient Banner for MRN: ${identifier}`, fhirId, encounterBundle, patientBundle);
        } else if (typeof openJsonInspectionWindow === 'function') {
            openJsonInspectionWindow(`Encounters & Patient Banner for MRN: ${identifier}`, fhirId, encounterBundle);
        }

        log("--- API CHAIN COMPLETE ---");

    } catch (error) {
        log(`<span style="color: red;">ERROR: Referral Workflow Failed: ${error.message}</span>`);
        console.error("Referral Workflow Failed:", error);
        alert(`Error: ${error.message}`);
    }
}
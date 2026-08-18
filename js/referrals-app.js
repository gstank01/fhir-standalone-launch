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
        referralIdentifierInput.value = ''; // clear out old inputs
        referralModal.classList.add('active'); 

        // Auto-focus the input box for better UX
        setTimeout(() => {
            referralIdentifierInput.focus();
        }, 100);
    });

    // 3. Hide the modal on Cancel
    cancelReferralBtn.addEventListener('click', () => {
        referralModal.classList.remove('active');
    });

    // 4. When the user clicks "Fetch Data", grab the ID and start the sequence
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

        console.log(`[Referral Flow] Starting sequence for identifier: ${identifier}`);

        // Start the API chain and wait for it to finish
        await executeReferralWorkflow(identifier);

        // Re-enable the button when done
        startReferralFetchBtn.disabled = false;
        startReferralFetchBtn.textContent = "Get info";
    });
}

async function executeReferralWorkflow(identifier) {
    try {
        log("--- STARTING API CHAIN ---");
        log(`Initiating workflow for identifier: ${identifier}`);

        // 1. Get Access Token & FHIR URL from Vercel
        const tokenResponse = await fetch('/api/getPatient', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: identifier })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) throw new Error(tokenData.error || "Failed to acquire token.");

        const accessToken = tokenData.token;
        const fhirUrl = tokenData.fhirUrl;

        // 2. Patient Lookup (Step C)
        const patientSearchUrl = `${fhirUrl}/Patient?identifier=${identifier}`;
        log(`Step C: Fetching Patient -> ${patientSearchUrl}`);

        const patientResponse = await fetch(patientSearchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        const patientBundle = await patientResponse.json();
        if (!patientResponse.ok) throw new Error(`Patient lookup failed: ${JSON.stringify(patientBundle)}`);

        log("SUCCESS: Patient Lookup Bundle Received.");

        // 3. Extract FHIR ID & Check Entries
        if (!patientBundle.entry || patientBundle.entry.length === 0) {
            log("WARNING: No matching patient resource found for the given identifier.");
            alert("Patient not found in EHR.");
            return;
        }

        const fhirId = patientBundle.entry[0].resource.id;
        log(`Step D: Extracted logical Patient FHIR ID: ${fhirId}`);

        // 🚀 OPTIONAL: Store patient bundle temporarily in sessionStorage if needed across windows
        sessionStorage.setItem('cached_patient_bundle', JSON.stringify(patientBundle));

        // 4. Encounter Fetch (Step E)
        const encounterUrl = `${fhirUrl}/Encounter?patient=${fhirId}&_include=Encounter:EpisodeOfCare`;
        log(`Step E: Fetching Encounters -> ${encounterUrl}`);

        const encounterResponse = await fetch(encounterUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        const encounterBundle = await encounterResponse.json();
        if (!encounterResponse.ok) throw new Error(`Encounter lookup failed: ${JSON.stringify(encounterBundle)}`);

        log("SUCCESS: Encounter Bundle Received.");
        log("Opening Encounter Record in JSON inspector window...");

        // 🚀 Pass BOTH the patientBundle and encounterBundle to your inspector window!
        // (Ensure your openReferralInspectorWindow function accepts patientBundle as an argument)
        openReferralInspectorWindow(`Encounters & Patient Banner for MRN: ${identifier}`, fhirId, encounterBundle, patientBundle);

        log("--- API CHAIN COMPLETE ---");

    } catch (error) {
        log(`<span style="color: red;">ERROR: Referral Workflow Failed: ${error.message}</span>`);
        console.error("Referral Workflow Failed:", error);
        alert(`Error: ${error.message}`);
    }
}
}

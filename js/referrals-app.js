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

async function sendToCqlGatekeeper(identifier) {
    // NOTE: api/evaluateCql.js does its own server-side FHIR fetch (auth +
    // Patient/Encounter lookup) keyed off `identifier` — it does not accept
    // pre-fetched bundles. Sending {patientId, patientBundle, encounterBundle}
    // here (the old shape) always 400'd with "Missing identifier.", silently,
    // since this call's errors are only logged, not surfaced to the user.
    try {
        console.log(`Sending identifier ${identifier} to CQL Gatekeeper...`);

        const response = await fetch('/api/evaluateCql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Server returned HTTP ${response.status}`);
        }

        if (data.success && data.actionRequired) {
            console.log(`Routing patient ${identifier} to Action Queue.`, data.queueItem);
        } else {
            console.log(`Patient ${identifier} evaluated successfully. No triage action required.`);
        }

    } catch (error) {
        console.error("Failed to send data to CQL Gatekeeper:", error);
    }
}



// The master function for the workflow
async function executeReferralWorkflow(identifier) {
    try {
        log("--- STARTING API CHAIN VIA Vercel ---");
        log(`Initiating workflow for identifier: ${identifier}`);

        // Step A & B: Ask Vercel backend to acquire Access Token and return FHIRURL
        log("Step A & B: Asking Vercel to securely acquire Access Token...");
        const tokenResponse = await fetch('/api/getPatient', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier: identifier })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
            throw new Error(tokenData.error || "Failed to acquire token.");
        }

        const accessToken = tokenData.token;
        const fhirUrl = tokenData.fhirUrl; // 👈 Grab the FHIR base URL passed from Vercel env!
        
        if (!fhirUrl) {
            throw new Error("FHIRURL environment variable is missing on the Vercel backend.");
        }

        log("SUCCESS: Access Token and FHIR URL acquired from Vercel.");

        // Step C: Patient Lookup using the Vercel FHIRURL variable
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

        // Step D: Extract FHIR ID & Fetch Encounters
        if (patientBundle.entry && patientBundle.entry.length > 0) {
            const fhirId = patientBundle.entry[0].resource.id;
            log(`Step D: Extracted logical Patient FHIR ID: ${fhirId}`);

            // Step E: Construct the Encounter URL using the same fhirUrl and token
            // 🐛 FIX: 'patient=' and 'Encounter:EpisodeOfCare' both silently returned
            // nothing on this FHIR server — see api/evaluateCql.js, which needed the
            // exact same fix ('subject=' + lowercase 'episode-of-care') to get any
            // encounters or episodes back at all.
            const encounterUrl = `${fhirUrl}/Encounter?subject=${fhirId}&_include=Encounter:episode-of-care`;
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

            log("Sending identifier to CQL Gatekeeper for evaluation...");
            await sendToCqlGatekeeper(identifier);

            log("Opening Encounter Record in JSON inspector window...");

            // Pass the Encounter Bundle to your pop-up window
            openReferralInspectorWindow(`Encounters & Patient Banner for MRN: ${identifier}`, fhirId, encounterBundle, patientBundle);

            log("Opening Encounter Record in JSON inspector window...");


        } else {
            log("WARNING: No matching patient resource found for the given identifier.");
            alert("Patient not found in EHR.");
        }

        log("--- API CHAIN COMPLETE ---");

    } catch (error) {
        log(`<span style="color: red;">ERROR: Referral Workflow Failed: ${error.message}</span>`);
        console.error("Referral Workflow Failed:", error);
        alert(`Error: ${error.message}`);
    }
}

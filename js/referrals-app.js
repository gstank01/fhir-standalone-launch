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

    // 4. When the user clicks "Get info", grab the ID and start the sequence
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

// The master function for the 4-step sequence
async function executeReferralWorkflow(identifier) {
    try {
        console.log("--- STARTING API CHAIN VIA VERCEL ---");
        console.log(`Sending patient identifier ${identifier} to Vercel...`);

        // --- STEP A & B: Exchange assertion for Access Token via Vercel ---
        const response = await fetch('/api/getPatient', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ identifier: identifier })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Failed to fetch token from backend.");
        }

        const accessToken = data.token;
        console.log("--- VERCEL RESPONDED SUCCESSFULLY! ---");
        console.log("Captured Access Token:", accessToken);

        // --- STEP C: Patient Lookup using FHIRURL and the entered identifier ---
        // Ensure CONFIG.FHIRURL exists (matching your config structure)
        const fhirBaseUrl = CONFIG.FHIRURL; 
        const patientSearchUrl = `${fhirBaseUrl}/Patient?identifier=${identifier}`;

        console.log(`Step C: Fetching Patient using URL: ${patientSearchUrl}`);

        const patientResponse = await fetch(patientSearchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/fhir+json'
            }
        });

        const patientBundle = await patientResponse.json();

        if (!patientResponse.ok) {
            throw new Error(`Patient lookup failed: ${JSON.stringify(patientBundle)}`);
        }

        console.log("--- PATIENT LOOKUP SUCCESSFUL ---");
        console.log("Patient Bundle Data:", patientBundle);

        alert("Success! Patient data retrieved using your FHIRURL and identifier. Check your console!");

        // --- STEP D: Optional next step (e.g., extract FHIR ID for Encounters) ---
        // if (patientBundle.entry && patientBundle.entry.length > 0) {
        //     const fhirId = patientBundle.entry[0].resource.id;
        //     console.log("Extracted Patient FHIR ID:", fhirId);
        // }

        console.log("--- API CHAIN COMPLETE ---");

    } catch (error) {
        console.error("Referral Workflow Failed:", error);
        alert(`Error: ${error.message}`);
    }
}

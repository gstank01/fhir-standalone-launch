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
        console.log("--- STARTING API CHAIN VIA Vercel ---");

        // Step A, B, & C: Handled securely by Vercel!
        console.log("Asking Vercel to get Token and execute Patient Lookup...");
        const response = await fetch('/api/getPatient', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ identifier: identifier })
        });

        const data = await response.json();

        // Check if Vercel threw a 500 or 400 error
        if (!response.ok) {
            throw new Error(data.error || "Failed to fetch patient data from Vercel.");
        }

        const patientBundle = data.patientBundle;
        console.log("Patient Lookup Bundle Received from Vercel:", patientBundle);

        // Step D: Encounter Fetch (Extracting FHIR ID if entries exist)
        if (patientBundle && patientBundle.entry && patientBundle.entry.length > 0) {
            const fhirId = patientBundle.entry[0].resource.id;
            console.log(`Step D: Found Patient FHIR ID: ${fhirId}`);
            
            // 🚀 NEW: Trigger the pop-up window to display the JSON
            openJsonInspectionWindow(`Patient Record: ${identifier}`, fhirId, patientBundle);

            // You can construct your subsequent encounter call here...
            
        } else {
            console.warn("No matching patient resource found for the given identifier.");
            alert("Patient not found in EHR.");
        } 

        console.log("--- API CHAIN COMPLETE ---");

    } catch (error) {
        console.error("Referral Workflow Failed:", error);
        alert(`Error: ${error.message}`);
    }
}

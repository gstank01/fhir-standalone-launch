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

// The master function for the 4-step sequence
async function executeReferralWorkflow(identifier) {
    try {
        console.log("--- STARTING API CHAIN ---");
        
        // Step A: Generate the Assertion (JWT)
        console.log("Step A: Generating Client Assertion...");
        // const assertion = await generateClientAssertion();
        
        // Step B: Get the Token
        console.log("Step B: Exchanging assertion for Access Token...");
        // const token = await getAccessToken(assertion);
        
        // Step C: Patient Lookup
        console.log(`Step C: Fetching Patient with identifier=${identifier}...`);
        // const fhirId = await getPatientFhirId(identifier, token);
        
        // Step D: Encounter Fetch
        console.log("Step D: Fetching Encounters using FHIR ID...");
        // const encounters = await getEncounters(fhirId, token);
        
        console.log("--- API CHAIN COMPLETE ---");
        
    } catch (error) {
        console.error("Referral Workflow Failed:", error);
    }
}

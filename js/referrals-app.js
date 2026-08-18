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

        // Send a POST request to our new Vercel backend
        const response = await fetch('/api/getPatient', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            // Send the user's input safely in the body of the request
            body: JSON.stringify({ identifier: identifier })
        });

        const data = await response.json();

        // Check if Vercel encountered an error
        if (!response.ok) {
            throw new Error(data.error || "Failed to fetch from backend.");
        }

        console.log("--- VERCEL RESPONDED SUCCESSFULLY! ---");
        console.log("Vercel Data Received:", data);
        
        alert("Success! Check your browser console to see the data from Vercel!");

    } catch (error) {
        console.error("Referral Workflow Failed:", error);
        alert(`Error: ${error.message}`);
    }
}

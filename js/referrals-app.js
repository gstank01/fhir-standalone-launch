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
            referralIdentifierInput.value = '';
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

            console.log(
                `[Referral Flow] Starting sequence for identifier: ${identifier}`
            );

            try {
                await executeReferralWorkflow(identifier);
            } finally {
                // Always re-enable the button when the workflow is finished
                startReferralFetchBtn.disabled = false;
                startReferralFetchBtn.textContent = "Get info";
            }
        });
    }
}


async function sendToCqlGatekeeper(
    patientBundle,
    encounterBundle,
    targetPatientId
) {
    try {
        // Merge the entries from both FHIR bundles
        const combinedEntries = [
            ...(patientBundle.entry || []),
            ...(encounterBundle.entry || [])
        ];

        // Construct a new ad-hoc FHIR collection Bundle
        const unifiedBundle = {
            resourceType: "Bundle",
            type: "collection",
            entry: combinedEntries
        };

        // ---------------------------------------------------------
        // Debug: Show what we are sending to the CQL backend
        // ---------------------------------------------------------

        console.log(
            "[Referral Debug] CQL target Patient ID:",
            targetPatientId
        );

        console.log(
            "[Referral Debug] Unified bundle resource types:",
            unifiedBundle.entry.map(
                entry => entry.resource?.resourceType
            )
        );

        console.log(
            "[Referral Debug] Patients in unified bundle:",
            unifiedBundle.entry
                .filter(
                    entry => entry.resource?.resourceType === "Patient"
                )
                .map(entry => ({
                    resourceType: entry.resource?.resourceType,
                    id: entry.resource?.id
                }))
        );

        console.log(
            "[Referral Debug] Encounters in unified bundle:",
            unifiedBundle.entry
                .filter(
                    entry => entry.resource?.resourceType === "Encounter"
                )
                .map(entry => ({
                    resourceType: entry.resource?.resourceType,
                    id: entry.resource?.id
                }))
        );

        // ---------------------------------------------------------
        // Send bundle to CQL Gatekeeper
        // ---------------------------------------------------------

        const response = await fetch('/api/evaluateCql', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                patientId: targetPatientId,
                fhirBundle: unifiedBundle
            })
        });

        // Validate HTTP Status range (200-299)
        if (!response.ok) {
            const errorText = await response.text();

            throw new Error(
                `Server returned HTTP ${response.status}: ${errorText}`
            );
        }

        const data = await response.json();

        // Process routing if gatekeeper logic evaluates true
        if (data.success && data.actionRequired) {
            console.log(
                `Routing patient ${targetPatientId} to Action Queue.`,
                data.routingData
            );
        } else {
            console.log(
                `Patient ${targetPatientId} evaluated successfully. ` +
                `No triage action required.`
            );
        }

    } catch (error) {
        console.error(
            "Failed to send data to CQL Gatekeeper:",
            error
        );

        // Optional UI fallback
        // alert(`Gatekeeper error: ${error.message}`);
    }
}


// -------------------------------------------------------------
// Master function for the workflow
// -------------------------------------------------------------

async function executeReferralWorkflow(identifier) {
    try {
        log("--- STARTING API CHAIN VIA Vercel ---");
        log(`Initiating workflow for identifier: ${identifier}`);

        // ---------------------------------------------------------
        // Step A & B:
        // Ask Vercel backend to acquire Access Token and return FHIR URL
        // ---------------------------------------------------------

        log(
            "Step A & B: Asking Vercel to securely acquire Access Token..."
        );

        const tokenResponse = await fetch('/api/getPatient', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                identifier: identifier
            })
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            throw new Error(
                tokenData.error || "Failed to acquire token."
            );
        }

        const accessToken = tokenData.token;
        const fhirUrl = tokenData.fhirUrl;

        if (!fhirUrl) {
            throw new Error(
                "FHIRURL environment variable is missing on the Vercel backend."
            );
        }

        log(
            "SUCCESS: Access Token and FHIR URL acquired from Vercel."
        );

        // ---------------------------------------------------------
        // Step C:
        // Patient Lookup
        // ---------------------------------------------------------

        const patientSearchUrl =
            `${fhirUrl}/Patient?identifier=${encodeURIComponent(identifier)}`;

        log(
            `Step C: Fetching Patient -> ${patientSearchUrl}`
        );

        const patientResponse = await fetch(patientSearchUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        const patientBundle = await patientResponse.json();

        if (!patientResponse.ok) {
            throw new Error(
                `Patient lookup failed: ${JSON.stringify(patientBundle)}`
            );
        }

        log("SUCCESS: Patient Lookup Bundle Received.");

        // ---------------------------------------------------------
        // Step D:
        // Find the actual Patient resource
        // Do NOT assume entry[0] is the Patient.
        // ---------------------------------------------------------

        const patientEntry = (patientBundle.entry || []).find(
            entry => entry.resource?.resourceType === "Patient"
        );

        if (!patientEntry) {
            log(
                "WARNING: No Patient resource found in the returned bundle."
            );

            alert("Patient not found in EHR.");
            return;
        }

        const fhirPatientId = patientEntry.resource.id;

        if (!fhirPatientId) {
            throw new Error(
                "Patient resource does not contain an id."
            );
        }

        log(
            `Step D: Extracted logical FHIR Patient ID: ${fhirPatientId}`
        );

        // ---------------------------------------------------------
        // Debug:
        // Confirm returned Patient ID
        // ---------------------------------------------------------

        console.log(
            "[Referral Debug] Patient ID:",
            fhirPatientId
        );

        console.log(
            "[Referral Debug] Patient resource:",
            patientEntry.resource
        );

        // ---------------------------------------------------------
        // Step E:
        // Fetch Encounters using the Patient ID
        // ---------------------------------------------------------

        const encounterUrl =
            `${fhirUrl}/Encounter?patient=${encodeURIComponent(fhirPatientId)}&_include=Encounter:EpisodeOfCare`;

        log(
            `Step E: Fetching Encounters -> ${encounterUrl}`
        );

        const encounterResponse = await fetch(encounterUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });

        const encounterBundle = await encounterResponse.json();

        if (!encounterResponse.ok) {
            throw new Error(
                `Encounter lookup failed: ${JSON.stringify(encounterBundle)}`
            );
        }

        log("SUCCESS: Encounter Bundle Received.");

        // ---------------------------------------------------------
        // Debug:
        // Show Encounter IDs and resource types
        // ---------------------------------------------------------

        console.log(
            "[Referral Debug] Encounter resources:",
            (encounterBundle.entry || [])
                .filter(
                    entry => entry.resource?.resourceType === "Encounter"
                )
                .map(entry => ({
                    resourceType: entry.resource?.resourceType,
                    id: entry.resource?.id
                }))
        );

        console.log(
            "[Referral Debug] All Encounter bundle resource types:",
            (encounterBundle.entry || []).map(
                entry => entry.resource?.resourceType
            )
        );

        // ---------------------------------------------------------
        // Step F:
        // CQL evaluation
        //
        // IMPORTANT:
        // Send the FHIR PATIENT ID, not an Encounter ID.
        // ---------------------------------------------------------

        log(
            "Sending bundle to CQL Gatekeeper for evaluation..."
        );

        await sendToCqlGatekeeper(
            patientBundle,
            encounterBundle,
            fhirPatientId
        );

        // ---------------------------------------------------------
        // Step G:
        // Open inspector
        // ---------------------------------------------------------

        log(
            "Opening Encounter Record in JSON inspector window..."
        );

        openReferralInspectorWindow(
            `Encounters & Patient Banner for MRN: ${identifier}`,
            fhirPatientId,
            encounterBundle,
            patientBundle
        );

        log(
            "Encounter Record opened in JSON inspector window."
        );

        log("--- API CHAIN COMPLETE ---");

    } catch (error) {
        log(
            `<span style="color: red;">` +
            `ERROR: Referral Workflow Failed: ${error.message}` +
            `</span>`
        );

        console.error(
            "Referral Workflow Failed:",
            error
        );

        alert(
            `Error: ${error.message}`
        );
    }
}
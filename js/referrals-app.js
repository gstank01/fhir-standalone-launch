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

        // OPTIONAL: Store patient bundle temporarily in sessionStorage if needed across windows
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

        // Pass BOTH the patientBundle and encounterBundle to your inspector window!
        // (Ensure your openReferralInspectorWindow function accepts patientBundle as an argument)
        openReferralInspectorWindow(`Encounters & Patient Banner for MRN: ${identifier}`, fhirId, encounterBundle, patientBundle);

        log("--- API CHAIN COMPLETE ---");

    } catch (error) {
        log(`<span style="color: red;">ERROR: Referral Workflow Failed: ${error.message}</span>`);
        console.error("Referral Workflow Failed:", error);
        alert(`Error: ${error.message}`);
    }
}

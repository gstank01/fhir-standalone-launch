document.addEventListener('DOMContentLoaded', () => {
    const btnCqlExecute = document.getElementById('btn-cql-execute');
    const cqlModal = document.getElementById('cqlModal');
    const cancelCqlBtn = document.getElementById('cancelCqlBtn');
    const cqlPatientTableBody = document.getElementById('cqlPatientTableBody');
    const cqlResultContainer = document.getElementById('cqlResultContainer');
    const cqlResultOutput = document.getElementById('cqlResultOutput');

    if (!btnCqlExecute) return;

    // 1. Open modal and load patient list from Neon database via API when button is clicked
    btnCqlExecute.addEventListener('click', async () => {
        cqlModal.classList.add('active');
        cqlResultContainer.style.display = 'none';
        log("Opening CQL Logic Evaluation modal worklist...");
        await loadCqlPatientsFromDB();
    });

    // 2. Close modal on cancel
    cancelCqlBtn.addEventListener('click', () => {
        cqlModal.classList.remove('active');
        log("CQL worklist modal closed.");
    });

    // 3. Fetch pre-populated patient worklist from Neon DB and populate table rows
    async function loadCqlPatientsFromDB() {
        cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">Loading secure worklist from database...</td></tr>';
        log("Fetching secure worklist from Neon database via /api/worklist...");
        
        try {
            const response = await fetch('/api/worklist');
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || "Failed to fetch worklist from database.");
            }

            const patients = data.patients;
            if (!patients || patients.length === 0) {
                log("WARNING: Worklist database returned zero records.");
                cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">No patient records found in worklist database.</td></tr>';
                return;
            }

            log(`SUCCESS: Loaded ${patients.length} patient record(s) from worklist database.`);
            cqlPatientTableBody.innerHTML = '';
            
            patients.forEach(item => {
                const patientName = item.name;
                const dob = item.dob || 'N/A';
                const identifier = item.identifier;

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">
                        <button class="primary-btn cql-eval-btn" data-identifier="${identifier}" style="padding: 5px 10px; font-size: 12px;">Evaluate</button>
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${patientName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${identifier}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${dob}</td>
                `;
                cqlPatientTableBody.appendChild(row);
            });

            // Bind click handlers to individual patient evaluation triggers using their secure database identifier
            document.querySelectorAll('.cql-eval-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const identifier = e.target.getAttribute('data-identifier');
                    log(`User selected worklist item with identifier: ${identifier}`);
                    await executeCqlWorkflowForIdentifier(identifier);
                });
            });

        } catch (error) {
            log(`<span style="color: red;">ERROR: Failed to load worklist: ${error.message}</span>`);
            cqlPatientTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px; color: red;">Error: ${error.message}</td></tr>`;
        }
    }

    // 4. Execute token retrieval, FHIR patient lookup by identifier, Encounter query, and CQL evaluation
    async function executeCqlWorkflowForIdentifier(identifier) {
        try {
            cqlResultContainer.style.display = 'block';
            cqlResultOutput.textContent = `Acquiring session token and looking up patient identifier: ${identifier}...`;
            log(`--- STARTING CQL EVALUATION WORKFLOW ---`);
            log(`Initiating workflow for patient identifier: ${identifier}`);

            // Get token and fhirUrl from Vercel backend using the database patient identifier
            log("Requesting session token and FHIR base URL from backend (/api/getPatient)...");
            const tokenResponse = await fetch('/api/getPatient', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: identifier })
            });

            const tokenData = await tokenResponse.json();
            if (!tokenResponse.ok) {
                throw new Error(tokenData.error || "Failed to acquire token session.");
            }

            const { token, fhirUrl } = tokenData;
            log("SUCCESS: Access Token and FHIR URL acquired.");

            cqlResultOutput.textContent = `Searching FHIR server for patient with identifier: ${identifier}...`;
            log(`Searching FHIR server -> ${fhirUrl}/Patient?identifier=${identifier}`);

            // Look up patient resource using the identifier to extract the FHIR logical ID
            const patientSearchUrl = `${fhirUrl}/Patient?identifier=${identifier}`;
            const patientResponse = await fetch(patientSearchUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });

            const patientBundle = await patientResponse.json();
            if (!patientBundle.entry || patientBundle.entry.length === 0) {
                throw new Error(`No FHIR record found for identifier: ${identifier}`);
            }

            const fhirId = patientBundle.entry[0].resource.id;
            cqlResultOutput.textContent = `Found Patient FHIR ID (${fhirId}). Fetching encounters...`;
            log(`SUCCESS: Extracted logical Patient FHIR ID: ${fhirId}`);

            // Fetch Encounters matching target patient including EpisodeOfCare
            log(`Fetching Encounters -> ${fhirUrl}/Encounter?patient=${fhirId}&_include=Encounter:EpisodeOfCare`);
            const encounterUrl = `${fhirUrl}/Encounter?patient=${fhirId}&_include=Encounter:EpisodeOfCare`;
            const encounterResponse = await fetch(encounterUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });
            const encounterBundle = await encounterResponse.json();

            if (!encounterResponse.ok) {
                throw new Error(`Encounter fetch failed: ${JSON.stringify(encounterBundle)}`);
            }
            log("SUCCESS: Encounter Bundle Received.");

            cqlResultOutput.textContent = `Evaluating CQL logic via Vercel for Patient ID ${fhirId}...`;
            log("Sending bundles to Vercel CQL Gatekeeper engine (/api/evaluateCql)...");

            // Post to Vercel API backend for CQL evaluation
            const evalResponse = await fetch('/api/evaluateCql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patientId: fhirId,
                    patientBundle: patientBundle,
                    encounterBundle: encounterBundle
                })
            });

            const evalData = await evalResponse.json();
            if (!evalResponse.ok) {
                throw new Error(evalData.error || "CQL evaluation failed on server.");
            }

            log("SUCCESS: CQL evaluation completed successfully.");
            cqlResultOutput.textContent = JSON.stringify(evalData, null, 2);
            log("--- CQL PIPELINE COMPLETE ---");

        } catch (error) {
            log(`<span style="color: red;">ERROR: CQL Workflow Failed: ${error.message}</span>`);
            cqlResultOutput.textContent = `Execution Error: ${error.message}`;
        }
    }
});
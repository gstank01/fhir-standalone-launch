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
        log('Opening CQL Logic Evaluation modal worklist...');
        await loadCqlPatientsFromDB();
    });

    // 2. Close modal on cancel
    cancelCqlBtn.addEventListener('click', () => {
        cqlModal.classList.remove('active');
        log('CQL worklist modal closed.');
    });

    // 3. Fetch pre-populated patient worklist from Neon DB and populate table rows
    async function loadCqlPatientsFromDB() {
        cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">Loading secure worklist from database...</td></tr>';
        log('Fetching secure worklist from Neon database via /api/worklist...');

        try {
            const response = await fetch('/api/worklist');
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch worklist from database.');
            }

            const patients = data.patients;
            if (!patients || patients.length === 0) {
                log('WARNING: Worklist database returned zero records.');
                cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">No patient records found in worklist database.</td></tr>';
                return;
            }

            log(`SUCCESS: Loaded ${patients.length} patient record(s) from worklist database.`);
            cqlPatientTableBody.innerHTML = '';

            patients.forEach(item => {
                const identifier = item.identifier;
                const row = document.createElement('tr');

                // --- Evaluate button cell ---
                const actionCell = document.createElement('td');
                actionCell.style.padding = '10px';
                actionCell.style.borderBottom = '1px solid #ddd';

                const evalBtn = document.createElement('button');
                evalBtn.className = 'primary-btn cql-eval-btn';
                evalBtn.style.padding = '5px 10px';
                evalBtn.style.fontSize = '12px';
                evalBtn.textContent = 'Evaluate';
                evalBtn.addEventListener('click', () => {
                    log(`User selected worklist item with identifier: ${identifier}`);
                    executeCqlWorkflowForIdentifier(identifier);
                });
                actionCell.appendChild(evalBtn);
                row.appendChild(actionCell);

                // --- Data cells ---
                // Built with textContent (not innerHTML) so a name, identifier,
                // or DOB value from the database can never be interpreted as
                // HTML/script by the browser.
                [item.name, identifier, item.dob || 'N/A'].forEach(value => {
                    const cell = document.createElement('td');
                    cell.style.padding = '10px';
                    cell.style.borderBottom = '1px solid #ddd';
                    cell.textContent = value;
                    row.appendChild(cell);
                });

                cqlPatientTableBody.appendChild(row);
            });

        } catch (error) {
            log(`<span style="color: red;">ERROR: Failed to load worklist: ${escapeHtml(error.message)}</span>`);
            cqlPatientTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px; color: red;">Error: ${escapeHtml(error.message)}</td></tr>`;
        }
    }

    // 4. Single backend call: the server does the token exchange, the
    // Patient/Encounter/EpisodeOfCare lookups, and the CQL evaluation.
    // The browser never sees the FHIR access token, the FHIR base URL,
    // or the raw patient/encounter bundles - only the final decision.
    async function executeCqlWorkflowForIdentifier(identifier) {
        try {
            cqlResultContainer.style.display = 'block';
            cqlResultOutput.textContent = `Evaluating referral triage logic for identifier: ${identifier}...`;
            log('--- STARTING CQL EVALUATION WORKFLOW ---');
            log(`Requesting evaluation for patient identifier: ${identifier}`);

            const evalResponse = await fetch('/api/evaluateCql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier })
            });

            // Read as text first so a non-JSON response (an HTML error/404
            // page, for example) produces a readable error instead of an
            // opaque "Unexpected token" JSON.parse failure.
            const rawBody = await evalResponse.text();
            let evalData;
            try {
                evalData = JSON.parse(rawBody);
            } catch {
                throw new Error(
                    `Server returned a non-JSON response (HTTP ${evalResponse.status}). ` +
                    `First 200 chars: ${rawBody.slice(0, 200)}`
                );
            }

            if (!evalResponse.ok) {
                throw new Error(evalData.error || 'CQL evaluation failed on server.');
            }

            log('SUCCESS: CQL evaluation completed successfully.');
            cqlResultOutput.textContent = JSON.stringify(evalData, null, 2);
            log('--- CQL PIPELINE COMPLETE ---');

        } catch (error) {
            log(`<span style="color: red;">ERROR: CQL Workflow Failed: ${escapeHtml(error.message)}</span>`);
            cqlResultOutput.textContent = `Execution Error: ${error.message}`;
        }
    }

    // Helper to safely format text inside HTML log lines
    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
});

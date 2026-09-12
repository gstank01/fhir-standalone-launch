document.addEventListener('DOMContentLoaded', () => {
    const btnCqlExecute = document.getElementById('btn-cql-execute');
    const cqlModal = document.getElementById('cqlModal');
    const cancelCqlBtn = document.getElementById('cancelCqlBtn');
    const cqlPatientTableBody = document.getElementById('cqlPatientTableBody');
    const cqlResultContainer = document.getElementById('cqlResultContainer');
    const cqlResultOutput = document.getElementById('cqlResultOutput');
    const cqlRuleSelect = document.getElementById('cqlRuleSelect');

    // Safe fallback check to ensure missing log() utilities do not crash the module execution thread
    function safeLog(message) {
        if (typeof log === 'function') {
            log(message);
        } else {
            console.log(`[CQL LOG]: ${message.replace(/<[^>]*>/g, '')}`);
        }
    }

    if (!btnCqlExecute) return;

    // 1. Open modal and load patient list + available rules from the API when button is clicked
    btnCqlExecute.addEventListener('click', async () => {
        cqlModal.classList.add('active');
        cqlResultContainer.style.display = 'none';
        safeLog('Opening CQL Logic Evaluation modal worklist...');
        await Promise.all([loadCqlPatientsFromDB(), loadCqlRules()]);
    });

    // 1b. Load the rules this workflow can invoke (cql_rules table, tagged
    // for the "cql-app" workflow) so a new rule added via POST /api/rules
    // shows up here with no code change.
    async function loadCqlRules() {
        if (!cqlRuleSelect) return;
        cqlRuleSelect.innerHTML = '<option value="">Loading rules...</option>';
        safeLog('Fetching available CQL rules via /api/rules...');

        try {
            const response = await fetch('/api/rules?workflow=cql-app&active=true');
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch CQL rules.');
            }

            const rules = data.rules || [];
            if (rules.length === 0) {
                cqlRuleSelect.innerHTML = '<option value="">No active rules found</option>';
                safeLog('<span style="color: orange;">WARNING: No active CQL rules tagged for the cql-app workflow. Add one via POST /api/rules.</span>');
                return;
            }

            cqlRuleSelect.innerHTML = '';
            rules.forEach(rule => {
                const option = document.createElement('option');
                option.value = rule.name;
                option.textContent = `${rule.name} (v${rule.version})${rule.description ? ' — ' + rule.description : ''}`;
                cqlRuleSelect.appendChild(option);
            });

            safeLog(`SUCCESS: Loaded ${rules.length} active CQL rule(s).`);
        } catch (error) {
            cqlRuleSelect.innerHTML = '<option value="">Error loading rules</option>';
            safeLog(`<span style="color: red;">ERROR: Failed to load CQL rules: ${escapeHtml(error.message)}</span>`);
        }
    }

    // 2. Close modal on cancel
    cancelCqlBtn.addEventListener('click', () => {
        cqlModal.classList.remove('active');
        safeLog('CQL worklist modal closed.');
    });

    // 3. Fetch pre-populated patient worklist from DB and populate table rows
    async function loadCqlPatientsFromDB() {
        cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">Loading secure worklist from database...</td></tr>';
        safeLog('Fetching secure worklist from database via /api/worklist...');

        try {
            const response = await fetch('/api/worklist');
            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Failed to fetch worklist from database.');
            }

            const patients = data.patients;
            if (!patients || patients.length === 0) {
                safeLog('WARNING: Worklist database returned zero records.');
                cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">No patient records found in worklist database.</td></tr>';
                return;
            }

            safeLog(`SUCCESS: Loaded ${patients.length} patient record(s) from worklist database.`);
            
            // OPTIMIZATION: Use DocumentFragment to batch DOM rendering and prevent browser layout thrashing
            const tableFragment = document.createDocumentFragment();

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
                    safeLog(`User selected worklist item with identifier: ${identifier}`);
                    executeCqlWorkflowForIdentifier(identifier, evalBtn);
                });
                
                actionCell.appendChild(evalBtn);
                row.appendChild(actionCell);

                // --- Data cells (Built securely using textContent) ---
                [item.name, identifier, item.dob || 'N/A'].forEach(value => {
                    const cell = document.createElement('td');
                    cell.style.padding = '10px';
                    cell.style.borderBottom = '1px solid #ddd';
                    cell.textContent = value;
                    row.appendChild(cell);
                });

                tableFragment.appendChild(row);
            });

            cqlPatientTableBody.innerHTML = '';
            cqlPatientTableBody.appendChild(tableFragment);

        } catch (error) {
            safeLog(`<span style="color: red;">ERROR: Failed to load worklist: ${escapeHtml(error.message)}</span>`);
            cqlPatientTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px; color: red;">Error: ${escapeHtml(error.message)}</td></tr>`;
        }
    }

    // 4. Single backend call: the server evaluates the CQL workflow logic safely.
    async function executeCqlWorkflowForIdentifier(identifier, triggeringButton) {
        // OPTIMIZATION: State lockout to block duplicate processing cycles on slow networks
        if (triggeringButton) {
            triggeringButton.disabled = true;
            triggeringButton.textContent = 'Processing...';
        }

        let evalData;
        try {
            const ruleName = cqlRuleSelect && cqlRuleSelect.value ? cqlRuleSelect.value : undefined;

            cqlResultContainer.style.display = 'block';
            cqlResultOutput.textContent = `Evaluating rule "${ruleName || '(default)'}" for identifier: ${identifier}...`;
            safeLog('--- STARTING CQL EVALUATION WORKFLOW ---');
            safeLog(`Requesting evaluation for patient identifier: ${identifier}, rule: ${ruleName || '(default)'}`);

            // NOTE: Ensure your backend file routing structure matches this endpoint exactly
            const evalResponse = await fetch('/api/evaluateCql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ruleName ? { identifier, ruleName } : { identifier })
            });

            const rawBody = await evalResponse.text();
            try {
                evalData = JSON.parse(rawBody);
            } catch {
                throw new Error(
                    `Server returned a non-JSON response (HTTP ${evalResponse.status}). ` +
                    `First 200 chars: ${rawBody.slice(0, 200)}`
                );
            }

            if (!evalResponse.ok) {
                // Show the full payload (includes our temporary debug fields)
                // in the result panel, not just the error string, so the
                // diagnostics are visible without checking server logs.
                cqlResultOutput.textContent = JSON.stringify(evalData, null, 2);
                throw new Error(evalData.error || 'CQL evaluation failed on server.');
            }

            safeLog('SUCCESS: CQL evaluation completed successfully.');
            cqlResultOutput.textContent = JSON.stringify(evalData, null, 2);

            if (evalData.actionRequired) {
                if (evalData.queuePersisted) {
                    safeLog(`SUCCESS: Patient ${identifier} added to the referral queue.`);
                } else {
                    safeLog(`<span style="color: orange;">WARNING: Patient ${identifier} matched the triage rule but could not be persisted to the referral queue (see server logs).</span>`);
                }
            } else {
                safeLog(`Patient ${identifier} evaluated successfully. No triage action required.`);
            }

            safeLog('--- CQL PIPELINE COMPLETE ---');

        } catch (error) {
            safeLog(`<span style="color: red;">ERROR: CQL Workflow Failed: ${escapeHtml(error.message)}</span>`);
            // Only overwrite with a plain message if we haven't already shown
            // the full response payload (e.g. the non-JSON-response case above
            // never gets that far, so it still needs this fallback text).
            if (!evalData) {
                cqlResultOutput.textContent = `Execution Error: ${error.message}`;
            }
        } finally {
            // Restore interactive capability back to the user element
            if (triggeringButton) {
                triggeringButton.disabled = false;
                triggeringButton.textContent = 'Evaluate';
            }
        }
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
});

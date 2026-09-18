document.addEventListener('DOMContentLoaded', () => {
    const btnCqlExecute = document.getElementById('btn-cql-execute');
    const cqlModal = document.getElementById('cqlModal');
    const cancelCqlBtn = document.getElementById('cancelCqlBtn');
    const cqlPatientTableBody = document.getElementById('cqlPatientTableBody');
    const cqlResultContainer = document.getElementById('cqlResultContainer');
    const cqlResultOutput = document.getElementById('cqlResultOutput');
    const cqlRuleSelect = document.getElementById('cqlRuleSelect');
    const fhirDataEl = document.getElementById('fhirData');

    // Populated by loadCqlRules() below, keyed by rule name — lets the
    // "show me the raw logic" pop-up look up a rule's CQL source without a
    // second network request every time the dropdown selection changes.
    let ruleInfoByName = {};

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
            ruleInfoByName = {};

            // Blank by default — the user has to actively pick a rule
            // rather than one being silently pre-selected.
            const blankOption = document.createElement('option');
            blankOption.value = '';
            blankOption.textContent = '-- Select a rule --';
            cqlRuleSelect.appendChild(blankOption);

            rules.forEach(rule => {
                const option = document.createElement('option');
                option.value = rule.name;
                option.textContent = `${rule.name} (v${rule.version})${rule.description ? ' — ' + rule.description : ''}`;
                cqlRuleSelect.appendChild(option);
                ruleInfoByName[rule.name] = rule;
            });
            cqlRuleSelect.value = '';

            safeLog(`SUCCESS: Loaded ${rules.length} active CQL rule(s).`);
        } catch (error) {
            cqlRuleSelect.innerHTML = '<option value="">Error loading rules</option>';
            safeLog(`<span style="color: red;">ERROR: Failed to load CQL rules: ${escapeHtml(error.message)}</span>`);
        }
    }

    // 1c. Whenever the user actually changes which rule is selected (not on
    // the silent initial population above — that never fires a `change`
    // event), show its raw, pre-compiled CQL source so it can be walked
    // through live. Works for any rule in the dropdown, not just these two.
    cqlRuleSelect?.addEventListener('change', () => {
        const selectedName = cqlRuleSelect.value;
        if (!selectedName) return;
        const rule = ruleInfoByName[selectedName];
        safeLog(`User selected CQL rule: ${selectedName}`);
        showActionDetail(`CQL Logic — ${selectedName}`, buildRuleLogicDetailHtml(rule, selectedName));
    });

    // Strips // comments out of a CQL source string for display — full
    // comment lines are dropped entirely, trailing comments are cut off
    // the end of a code line, and the resulting run of blank lines left
    // behind by a removed comment block is collapsed to one.
    function stripCqlComments(cqlText) {
        return cqlText
            .split('\n')
            .filter(line => !line.trim().startsWith('//'))
            .map(line => {
                const idx = line.indexOf('//');
                return idx === -1 ? line : line.slice(0, idx).replace(/\s+$/, '');
            })
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    // Shows the human-readable CQL source exactly as stored in the
    // cql_rules.cql_text column (minus // comments) — the plain logic that
    // was hand-compiled into the ELM the engine actually executes, not the
    // compiled ELM itself.
    function buildRuleLogicDetailHtml(rule, ruleName) {
        if (!rule || !rule.cqlText) {
            return `<p>No stored CQL source found for <strong>${escapeHtml(ruleName)}</strong>.</p>`;
        }

        const plainLogic = stripCqlComments(rule.cqlText);
        return `<pre style="font-size:12.5px; background:#ffffff; color:#1e2430; border:1px solid #ddd; padding:12px; border-radius:4px; overflow-x:auto; white-space:pre-wrap; line-height:1.5;">${escapeHtml(plainLogic)}</pre>`;
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
        const ruleName = cqlRuleSelect && cqlRuleSelect.value ? cqlRuleSelect.value : undefined;
        try {
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

            // Show the raw FHIR bundle(s) the server fetched, in the same
            // "FHIR Response Data" panel the GET Appointments flow uses —
            // populated whenever the response carries them, success or not.
            renderFhirData(evalData);

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
                    // Refresh the on-page queue panel (js/queue-app.js) so the
                    // new entry shows up without a manual reload.
                    window.refreshReferralQueue?.();
                } else {
                    safeLog(`<span style="color: orange;">WARNING: Patient ${identifier} matched the triage rule but could not be persisted to the referral queue (see server logs).</span>`);
                }
            } else {
                safeLog(`Patient ${identifier} evaluated successfully. No triage action required.`);
            }

            safeLog('--- CQL PIPELINE COMPLETE ---');

            showActionDetail(`Evaluate — ${identifier}`, buildEvaluateDetailHtml(identifier, ruleName, evalData));

        } catch (error) {
            safeLog(`<span style="color: red;">ERROR: CQL Workflow Failed: ${escapeHtml(error.message)}</span>`);
            // Only overwrite with a plain message if we haven't already shown
            // the full response payload (e.g. the non-JSON-response case above
            // never gets that far, so it still needs this fallback text).
            if (!evalData) {
                cqlResultOutput.textContent = `Execution Error: ${error.message}`;
            }
            showActionDetail(`Evaluate — ${identifier} (failed)`, buildEvaluateDetailHtml(identifier, ruleName, evalData, error));
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

    // Builds the plain-language "what just happened" walkthrough for the
    // Evaluate action's pop-up — same data already in evalData/error, just
    // narrated instead of left as a raw JSON dump, for a live demo audience.
    function buildEvaluateDetailHtml(identifier, ruleName, evalData, error) {
        const ruleLabel = ruleName || '(default rule)';
        const parts = [];

        parts.push(`<p>Here's exactly what happened when <strong>Evaluate</strong> was clicked for identifier <code>${escapeHtml(identifier)}</code>:</p>`);
        parts.push('<ol style="padding-left: 20px;">');
        parts.push(`<li>Sent <code>{ identifier: "${escapeHtml(identifier)}", ruleName: "${escapeHtml(ruleLabel)}" }</code> to <code>/api/evaluateCql</code>.</li>`);

        if (!evalData) {
            // Never got a parseable response back at all.
            parts.push(`<li style="color:#c4433b;">Request failed before the server could respond: ${escapeHtml(error?.message || 'unknown error')}.</li>`);
            parts.push('</ol>');
            return parts.join('');
        }

        const patientCount = evalData.patientBundle?.entry?.length ?? 0;
        parts.push(`<li>Server authenticated with the FHIR server and searched for the Patient record — <strong>${patientCount} found</strong>.</li>`);

        if (!evalData.success && !evalData.encounterBundle && !evalData.appointmentBundle) {
            // 404-style: no patient found, pipeline stopped there.
            parts.push(`<li style="color:#c4433b;">${escapeHtml(evalData.error || 'No matching patient — evaluation stopped here.')}</li>`);
            parts.push('</ol>');
            return parts.join('');
        }

        // Only one of these two is ever fetched for a given evaluation —
        // which rule is selected decides which FHIR query goes out, so
        // only the line for the bundle actually returned is shown.
        if (evalData.encounterBundle) {
            const encounterCount = evalData.encounterBundle.entry?.length ?? 0;
            parts.push(`<li>Server searched for Encounter + EpisodeOfCare records for that patient — <strong>${encounterCount} resource(s) found</strong>.</li>`);
        }
        if (evalData.appointmentBundle) {
            const appointmentCount = evalData.appointmentBundle.entry?.length ?? 0;
            parts.push(`<li>Server searched for Appointment + Location records for that patient — <strong>${appointmentCount} resource(s) found</strong>.</li>`);
        }

        if (!evalData.success) {
            parts.push(`<li style="color:#c4433b;">${escapeHtml(evalData.error || 'Evaluation failed on the server — see the raw response below.')}</li>`);
            parts.push('</ol>');
            parts.push(rawJsonDetails(evalData));
            return parts.join('');
        }

        parts.push(`<li>Server loaded the compiled rule <strong>"${escapeHtml(evalData.ruleName || ruleLabel)}"</strong> from the <code>cql_rules</code> table and ran it against the combined data.</li>`);

        if (evalData.ruleDescription) {
            parts.push(`<li>What this rule looks for: <em>${escapeHtml(evalData.ruleDescription)}</em></li>`);
        }
        if (evalData.resultExpression) {
            parts.push(`<li>The logic's final answer is the <code>${escapeHtml(evalData.resultExpression)}</code> expression — everything below builds up to that one boolean.</li>`);
        }

        if (evalData.findings && Object.keys(evalData.findings).length > 0) {
            parts.push('<li>What it found, before the final decision:<ul style="margin-top:6px;">');
            Object.entries(evalData.findings).forEach(([key, value]) => {
                parts.push(`<li><code>${escapeHtml(key)}</code>: <strong>${escapeHtml(String(value))}</strong></li>`);
            });
            parts.push('</ul></li>');
        }

        if (Array.isArray(evalData.evaluationTrace) && evalData.evaluationTrace.length > 0) {
            parts.push('<li>Full step-by-step reasoning behind that:<ul style="margin-top:6px;">');
            evalData.evaluationTrace.forEach(t => {
                parts.push(`<li style="font-family: monospace; font-size: 12.5px; color: #444;">[Step ${t.step}] ${escapeHtml(t.message)}</li>`);
            });
            parts.push('</ul></li>');
        }

        const verdictColor = evalData.actionRequired ? '#1e8e5a' : '#5b6472';
        parts.push(`<li><strong>Final result:</strong> <span style="color:${verdictColor}; font-weight:700;">actionRequired = ${evalData.actionRequired}</span></li>`);

        if (evalData.actionRequired) {
            const items = Array.isArray(evalData.queueItems) && evalData.queueItems.length > 0
                ? evalData.queueItems
                : (evalData.queueItem ? [evalData.queueItem] : []);

            if (items.length > 1) {
                // AppointmentLocationLogic case — one row per matching appointment.
                parts.push(`<li>${items.length} matching appointments were written to the <code>referral_queue</code> table, one row each:<ul style="margin-top:6px;">`);
                items.forEach(item => {
                    const rowColor = item.persisted === false ? '#b8791a' : '#1e8e5a';
                    parts.push(`<li style="color:${rowColor};">Appointment <code>${escapeHtml(item.appointmentId || '?')}</code> — <strong>${escapeHtml(item.locationName || 'unknown location')}</strong>${item.persisted === false ? ' (write failed)' : ''}</li>`);
                });
                parts.push('</ul></li>');
            } else if (items.length === 1 && evalData.queuePersisted) {
                const locationSuffix = items[0].locationName ? ` at <strong>${escapeHtml(items[0].locationName)}</strong>` : '';
                parts.push(`<li style="color:#1e8e5a;">Patient was written to the <code>referral_queue</code> table${locationSuffix} and now appears in the Referral Queue panel below.</li>`);
            } else {
                parts.push('<li style="color:#b8791a;">Patient matched the rule, but the write to <code>referral_queue</code> failed — check server logs.</li>');
            }
        } else {
            parts.push('<li>No triage action required — nothing was written to the queue.</li>');
        }

        parts.push('</ol>');
        parts.push(rawJsonDetails(evalData));
        return parts.join('');
    }

    function rawJsonDetails(evalData) {
        return `<details style="margin-top:12px;"><summary style="cursor:pointer; color:#0076d6;">Raw response JSON</summary><pre style="font-size:11.5px; background:#1e1e1e; color:#4af626; padding:10px; border-radius:4px; overflow-x:auto;">${escapeHtml(JSON.stringify(evalData, null, 2))}</pre></details>`;
    }

    // Renders the raw Patient/Encounter bundles api/evaluateCql.js fetched
    // from the FHIR server into the main page's "FHIR Response Data" panel.
    function renderFhirData(evalData) {
        if (!fhirDataEl) return;

        if (!evalData || (!evalData.patientBundle && !evalData.encounterBundle && !evalData.appointmentBundle)) {
            fhirDataEl.textContent = 'No FHIR bundle returned for this request.';
            return;
        }

        fhirDataEl.textContent = JSON.stringify(
            { patientBundle: evalData.patientBundle, encounterBundle: evalData.encounterBundle, appointmentBundle: evalData.appointmentBundle },
            null,
            2
        );
    }
});

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

    // 1d. Info icon above the rule selector — explains the v1 -> v2 change
    // (matched-resources Bundle) that applies to both rules, independent of
    // whichever one happens to be selected right now.
    document.getElementById('cqlLogicInfoBtn')?.addEventListener('click', () => {
        safeLog('User opened the "what changed in v2" info popup.');
        showActionDetail('CQL Logic — What Changed in v2', buildLogicChangelogHtml());
    });

    function buildLogicChangelogHtml() {
        const sectionHeader = text => `<h3 style="font-size:15px; margin:20px 0 8px; color:#1e2430;">${text}</h3>`;
        const calloutBox = (bg, border, html) => `<div style="background:${bg}; border:1px solid ${border}; border-radius:6px; padding:12px 14px; margin:10px 0;">${html}</div>`;
        const codeExcerptBlock = (title, code) => `
            <p style="font-weight:600; font-size:13.5px; margin:14px 0 4px;">${title}</p>
            <pre style="font-size:12px; background:#ffffff; color:#1e2430; border:1px solid #ddd; padding:10px 12px; border-radius:4px; overflow-x:auto; white-space:pre; line-height:1.5;">${escapeHtml(code)}</pre>
        `;

        return `
            ${calloutBox('#eef4fb', '#cfe0f3', `<strong>In a nutshell:</strong> v2 doesn't change the logic; it just also hands back a ready-to-use FHIR <code>Bundle</code> of exactly what matched, instead of only a true/false answer.`)}

            ${sectionHeader("What's new")}
            <p>Both rules moved from <strong>v1.0.0</strong> to <strong>v2.0.0</strong>. A successful match now returns one new field, <code>matchedBundle</code> — a complete FHIR Bundle containing:</p>
            <ul style="padding-left:20px;">
                <li><strong>ReferralTriageLogic:</strong> the Patient + the Encounter(s) and EpisodeOfCare(s) that matched</li>
                <li><strong>AppointmentLocationLogic:</strong> the Patient + each matching Appointment and its Location</li>
            </ul>

            ${sectionHeader('What stayed exactly the same')}
            <ul style="padding-left:20px;">
                <li>The CQL logic itself — word for word, unchanged</li>
                <li>Which patients or appointments qualify — a v1.0.0 match is still a v2.0.0 match</li>
                <li>The output queue, and everything already written to it</li>
                <li>The rule dropdown and the toggle between the two rules</li>
            </ul>
            <p style="color:#5b6472; font-size:13px;">(For the record: v1.0.0 is preserved untouched in this repo's history — v2 was added alongside it, not by editing it.)</p>

            ${sectionHeader('Who does the work, today')}
            <p>Three systems touch a single evaluation. Only one of them builds the Bundle:</p>
            <ol style="padding-left:20px;">
                <li><strong>Epic (the FHIR server)</strong> — answers the GET request and returns a bundle acording to the Epic configuration.</li>
                <li><strong>This app's backend (Vercel)</strong> — runs the CQL logic <em>and</em> builds the Bundle, in the same step, before it ever sends a response.</li>
                <li><strong>Whoever calls this app</strong> — just reads <code>matchedBundle</code> out of the response. Nothing to build, nothing to reassemble.</li>
            </ol>
            ${calloutBox('#eef7f0', '#cdeadd', `A caller can forward <code>matchedBundle</code> to another system, POST it straight to a FHIR server, save it, or display it — as-is, with zero extra code.`)}

            ${sectionHeader("Could the CQL logic itself produce the Bundle?")}
            <p>No — and this isn't a gap we could close later, it's how CQL works by design. CQL is a <strong>query language</strong>: it's built to answer questions like "does this patient qualify," not to construct new resources like a <code>Bundle</code>. It already computes the matching data internally (that's exactly what its own named rules like "Active Episodes of Care" are) — what it can't do is wrap that into a formal FHIR container resource. That packaging step is simple, but it always has to happen in the surrounding code, never inside the CQL logic itself — regardless of which platform is running it.</p>

            ${sectionHeader('If this becomes an InterSystems Health Connect implementation')}
            <p>The same packaging step needs a home there too. There are two options:</p>
            <table style="width:100%; border-collapse:collapse; font-size:13.5px; margin:10px 0;">
                <thead>
                    <tr style="background:#f4f4f4;">
                        <th style="text-align:left; padding:8px 10px; border:1px solid #ddd; width:22%;"></th>
                        <th style="text-align:left; padding:8px 10px; border:1px solid #ddd;">Option A — Java builds it</th>
                        <th style="text-align:left; padding:8px 10px; border:1px solid #ddd;">Option B — ObjectScript builds it</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding:8px 10px; border:1px solid #ddd; font-weight:600;">Who packages the Bundle</td>
                        <td style="padding:8px 10px; border:1px solid #ddd;">The Java class that runs the CQL logic</td>
                        <td style="padding:8px 10px; border:1px solid #ddd;">The ObjectScript Business Process, after Java hands back a plain true/false</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 10px; border:1px solid #ddd; font-weight:600;">Java stays a "pure function"?</td>
                        <td style="padding:8px 10px; border:1px solid #ddd;">No — it now returns boolean + Bundle</td>
                        <td style="padding:8px 10px; border:1px solid #ddd;">Yes — unchanged from the original design</td>
                    </tr>
                    <tr>
                        <td style="padding:8px 10px; border:1px solid #ddd; font-weight:600;">Matches this app's pattern?</td>
                        <td style="padding:8px 10px; border:1px solid #ddd;">Yes — same as Vercel today</td>
                        <td style="padding:8px 10px; border:1px solid #ddd;">No — splits the work across two components</td>
                    </tr>
                </tbody>
            </table>
            ${calloutBox('#fbf3e6', '#f0dcb3', `<strong>Recommendation: Option A.</strong> The Java CQL engine likely already exposes the matched resources as real, usable FHIR objects — so Java can hand them straight to the Bundle without re-implementing the matching logic a second time in ObjectScript (Option B would mean writing that logic twice).`)}

            ${sectionHeader('Appendix — see it in the real code')}
            <p style="color:#5b6472; font-size:13px;">Verbatim excerpts from <code>api/evaluateCql.js</code> as it runs today, with a plain-language walkthrough and a worked example for the two matching functions, for anyone who wants proof rather than a description.</p>

            ${codeExcerptBlock(
                '1. The assembly function — turns a Patient + a list of resources into a real FHIR Bundle',
                `function buildMatchedBundle(patientResource, resources) {
  const seen = new Set();
  const entries = [];

  const addResource = r => {
    if (!r) return;
    const key = \`\${r.resourceType}/\${r.id}\`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ fullUrl: key, resource: r });
  };

  addResource(patientResource);
  resources.forEach(addResource);

  return { resourceType: 'Bundle', type: 'collection', entry: entries };
}`
            )}

            ${codeExcerptBlock(
                '2. Re-deriving ReferralTriageLogic\'s matches from the raw bundle — same criteria the CQL itself checks',
                `function extractMatchingEncountersAndEpisodes(encounterBundle) {
  const allEncounters = encounterBundle.entry
    .filter(e => e.resource.resourceType === 'Encounter').map(e => e.resource);
  const allEpisodes = encounterBundle.entry
    .filter(e => e.resource.resourceType === 'EpisodeOfCare').map(e => e.resource);

  const activeEpisodes = allEpisodes.filter(ep => ep.status === 'active');
  const activeEpisodeRefs = new Set(activeEpisodes.map(ep => \`EpisodeOfCare/\${ep.id}\`));

  const referralEncounters = allEncounters.filter(enc =>
    (enc.type || []).some(t => (t.coding || [])
      .some(c => c.system === HOSPITAL_CODE_SYSTEM && c.code === REFERRAL_TRIAGE_CODE))
  );

  const matchedEncounters = referralEncounters.filter(enc =>
    (enc.episodeOfCare || []).some(eoc => activeEpisodeRefs.has(eoc.reference))
  );
  // ...matchedEpisodes derived the same way from matchedEncounters
  return { encounters: matchedEncounters, episodes: matchedEpisodes };
}`
            )}
            <p style="font-size:13px;"><strong>Walkthrough:</strong> split the bundle into all Encounters and all EpisodeOfCares → keep only the <em>active</em> episodes, and build a lookup set of their reference strings (e.g. <code>"EpisodeOfCare/abc123"</code>) → keep only encounters tagged with the Referral Triage code (system + code <code>2611</code>) → keep only those encounters whose <code>episodeOfCare</code> list actually points at one of the active episodes. Those two filters are the same two conditions the CQL logic itself checks — this just re-runs them on the raw, unwrapped FHIR JSON so the result is bundle-ready.</p>

            ${codeExcerptBlock(
                '3. Re-deriving AppointmentLocationLogic\'s matches — same criteria the CQL itself checks',
                `function extractMatchingAppointmentLocations(appointmentBundle) {
  const targetSiteRef = \`Location/\${SITE_LOCATION_CODES.RPY01.locationId}\`;

  const locationsById = {};
  appointmentBundle.entry
    .filter(e => e.resource.resourceType === 'Location')
    .forEach(e => { locationsById[e.resource.id] = e.resource; });

  const targetLocationRefs = new Set(
    Object.values(locationsById)
      .filter(loc => loc.partOf && loc.partOf.reference === targetSiteRef)
      .map(loc => \`Location/\${loc.id}\`)
  );

  const matches = [];
  appointmentBundle.entry
    .filter(e => e.resource.resourceType === 'Appointment')
    .forEach(e => {
      const appt = e.resource;
      const matchedParticipant = (appt.participant || [])
        .find(p => p.actor && targetLocationRefs.has(p.actor.reference));
      if (!matchedParticipant) return;

      const location = locationsById[matchedParticipant.actor.reference.split('/')[1]];
      matches.push({ appointmentId: appt.id, appointmentStatus: appt.status, locationName: location.name, /* ... */ });
    });

  return matches;
}`
            )}
            <p style="font-size:13px;"><strong>Walkthrough:</strong> index every Location resource in the bundle by id → keep only the ones whose <code>partOf</code> points at the RPY01 site Location → for each Appointment, check whether any of its <code>participant</code> entries reference one of those site Locations; if none do, skip it → for each match, look up the actual Location it pointed to and record both the summary fields (status, name, etc.) and the raw resources for the Bundle.</p>

            <p style="font-size:13px; font-weight:600; margin:10px 0 4px;">Worked example</p>
            <p style="font-size:13px;">A bundle with two Locations and two Appointments — only one of each actually qualifies:</p>
            ${codeExcerptBlock(
                'Input (trimmed)',
                `[
  { "resourceType": "Location", "id": "loc-chelsea-clinic2", "name": "Chelsea - Clinic 2",
    "partOf": { "reference": "Location/eLVUrSrT4-KVXjmLgWvTBDg3" } },   // <- RPY01 site

  { "resourceType": "Location", "id": "loc-other-site", "name": "Some Other Hospital",
    "partOf": { "reference": "Location/someOtherSiteId" } },           // <- NOT RPY01

  { "resourceType": "Appointment", "id": "appt-001", "status": "booked", "start": "2026-01-15T10:00:00Z",
    "participant": [
      { "actor": { "reference": "Patient/pat1" } },
      { "actor": { "reference": "Location/loc-chelsea-clinic2" } }     // <- points at RPY01 site
    ] },

  { "resourceType": "Appointment", "id": "appt-002", "status": "fulfilled",
    "participant": [
      { "actor": { "reference": "Location/loc-other-site" } }         // <- points elsewhere
    ] }
]`
            )}
            <p style="font-size:13px;"><strong>Result:</strong> <code>targetLocationRefs</code> ends up containing only <code>"Location/loc-chelsea-clinic2"</code> (the other Location's <code>partOf</code> doesn't match). <code>appt-001</code>'s participant list includes that reference → <strong>match</strong>, recorded with status <code>"booked"</code> and location name <code>"Chelsea - Clinic 2"</code>. <code>appt-002</code>'s only participant is the other Location → no match → skipped entirely. <code>matches</code> ends up with exactly one entry, for <code>appt-001</code>.</p>

            ${codeExcerptBlock(
                '4. Wired into one evaluation — called right after the CQL engine\'s boolean result',
                `matchedBundle = buildMatchedBundle(
  patientResource,
  appointmentMatches.flatMap(m => [m.apptResource, m.locationResource])
);`
            )}
        `;
    }

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

        const engineNote = `<p style="font-size:13px; color:#5b6472;">The CQL below is source/reference only — Vercel never parses it at request time. <code>POST /api/evaluateCql</code> runs as a Node.js serverless function that loads this rule's pre-compiled ELM (JSON, stored in <code>cql_rules.elm_json</code>) into the <code>cql-execution</code> npm package's <code>cql.Library</code>, wraps the fetched FHIR bundle in <code>cql-exec-fhir</code>'s <code>PatientSource</code>, and calls <code>cql.Executor.exec()</code> against it. That run evaluates every <code>define</code> in order and returns this rule's final boolean, which is what decides whether a row gets written to <code>referral_queue</code>.</p>`;

        const plainLogic = stripCqlComments(rule.cqlText);
        return `${engineNote}<pre style="font-size:12.5px; background:#ffffff; color:#1e2430; border:1px solid #ddd; padding:12px; border-radius:4px; overflow-x:auto; white-space:pre-wrap; line-height:1.5;">${escapeHtml(plainLogic)}</pre>`;
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
            // Trimmed to just the two things that matter at a glance — the
            // logic's outcome and the resulting Bundle. Everything else
            // (findings, trace, queue items, source bundles) is still one
            // click away in the Evaluate pop-up's "Raw response JSON".
            cqlResultOutput.textContent = JSON.stringify(
                { actionRequired: evalData.actionRequired, matchedBundle: evalData.matchedBundle ?? null },
                null,
                2
            );

            if (evalData.actionRequired) {
                if (evalData.queuePersisted) {
                    safeLog(`SUCCESS: Patient ${identifier} added to the output queue.`);
                    // Refresh the on-page queue panel (js/queue-app.js) so the
                    // new entry shows up without a manual reload.
                    window.refreshReferralQueue?.();
                } else {
                    safeLog(`<span style="color: orange;">WARNING: Patient ${identifier} matched the triage rule but could not be persisted to the output queue (see server logs).</span>`);
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
                parts.push(`<li style="color:#1e8e5a;">Patient was written to the <code>referral_queue</code> table${locationSuffix} and now appears in the Output Queue panel below.</li>`);
            } else {
                parts.push('<li style="color:#b8791a;">Patient matched the rule, but the write to <code>referral_queue</code> failed — check server logs.</li>');
            }
        } else {
            parts.push('<li>No triage action required — nothing was written to the queue.</li>');
        }

        if (evalData.matchedBundle && Array.isArray(evalData.matchedBundle.entry)) {
            parts.push(`<li>Server also returned a FHIR <code>Bundle</code> (<code>matchedBundle</code>) containing exactly the <strong>${evalData.matchedBundle.entry.length}</strong> resource(s) that made this evaluation true — see "FHIR Response Data" or the raw JSON below.</li>`);
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

        if (!evalData || (!evalData.patientBundle && !evalData.encounterBundle && !evalData.appointmentBundle && !evalData.matchedBundle)) {
            fhirDataEl.textContent = 'No FHIR bundle returned for this request.';
            return;
        }

        fhirDataEl.textContent = JSON.stringify(
            {
                patientBundle: evalData.patientBundle,
                encounterBundle: evalData.encounterBundle,
                appointmentBundle: evalData.appointmentBundle,
                // v2: the resources that actually made the rule evaluate to
                // true, packaged as their own FHIR Bundle.
                matchedBundle: evalData.matchedBundle
            },
            null,
            2
        );
    }
});

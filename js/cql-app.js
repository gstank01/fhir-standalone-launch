document.addEventListener('DOMContentLoaded', () => {
    const btnCqlExecute = document.getElementById('btn-cql-execute');
    const cqlModal = document.getElementById('cqlModal');
    const cancelCqlBtn = document.getElementById('cancelCqlBtn');
    const cqlPatientTableBody = document.getElementById('cqlPatientTableBody');
    const cqlResultContainer = document.getElementById('cqlResultContainer');
    const cqlResultOutput = document.getElementById('cqlResultOutput');

    if (!btnCqlExecute) return;

    // 1. Open modal and load patient list when button is clicked
    btnCqlExecute.addEventListener('click', async () => {
        cqlModal.classList.add('active');
        cqlResultContainer.style.display = 'none';
        await loadCqlPatients();
    });

    // 2. Close modal on cancel
    cancelCqlBtn.addEventListener('click', () => {
        cqlModal.classList.remove('active');
    });

    // 3. Fetch tokens and populate patient table rows
    async function loadCqlPatients() {
        cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">Loading patient records...</td></tr>';
        
        try {
            const tokenResponse = await fetch('/api/getPatient', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'list' })
            });

            const tokenData = await tokenResponse.json();
            if (!tokenResponse.ok) {
                throw new Error(tokenData.error || "Failed to acquire token session.");
            }

            const { token, fhirUrl } = tokenData;

            // Query FHIR server for patient records to populate the table
            const patientResponse = await fetch(`${fhirUrl}/Patient?_count=10`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/json'
                }
            });

            const bundle = await patientResponse.json();
            if (!bundle.entry || bundle.entry.length === 0) {
                cqlPatientTableBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:15px;">No patients found in FHIR server.</td></tr>';
                return;
            }

            cqlPatientTableBody.innerHTML = '';
            
            bundle.entry.forEach(entry => {
                const patient = entry.resource;
                const fhirId = patient.id;
                const nameObj = patient.name && patient.name[0] ? patient.name[0] : { given: ['Unknown'], family: '' };
                const patientName = `${nameObj.given.join(' ')} ${nameObj.family}`;
                const dob = patient.birthDate || 'N/A';
                const identifier = patient.identifier && patient.identifier[0] ? patient.identifier[0].value : 'N/A';

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">
                        <button class="primary-btn cql-eval-btn" data-id="${fhirId}" style="padding: 5px 10px; font-size: 12px;">Evaluate</button>
                    </td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${patientName}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${identifier}</td>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${dob}</td>
                `;
                cqlPatientTableBody.appendChild(row);
            });

            // Bind click handlers to individual patient evaluation triggers
            document.querySelectorAll('.cql-eval-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const targetPatientId = e.target.getAttribute('data-id');
                    await executeCqlWorkflowForPatient(targetPatientId, token, fhirUrl);
                });
            });

        } catch (error) {
            cqlPatientTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:15px; color: red;">Error: ${error.message}</td></tr>`;
        }
    }

    // 4. Execute the FHIR Encounter query and send bundles to CQL Gatekeeper
    async function executeCqlWorkflowForPatient(fhirId, token, fhirUrl) {
        try {
            cqlResultContainer.style.display = 'block';
            cqlResultOutput.textContent = `Fetching patient & encounter context for ID: ${fhirId}...`;

            // Fetch specific Patient Resource
            const patientResponse = await fetch(`${fhirUrl}/Patient/${fhirId}`, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });
            const patientBundle = await patientResponse.json();

            // Fetch Encounters matching target patient including EpisodeOfCare
            const encounterUrl = `${fhirUrl}/Encounter?patient=${fhirId}&_include=Encounter:EpisodeOfCare`;
            const encounterResponse = await fetch(encounterUrl, {
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
            });
            const encounterBundle = await encounterResponse.json();

            if (!encounterResponse.ok) {
                throw new Error(`Encounter fetch failed: ${JSON.stringify(encounterBundle)}`);
            }

            cqlResultOutput.textContent = `Evaluating CQL logic via Vercel for Patient ${fhirId}...`;

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

            cqlResultOutput.textContent = JSON.stringify(evalData, null, 2);

        } catch (error) {
            cqlResultOutput.textContent = `Execution Error: ${error.message}`;
        }
    }
});
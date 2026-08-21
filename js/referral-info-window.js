// js/json-inspect-window.js

function openReferralInspectorWindow(titleText, fhirId, encounterBundle, patientBundle) {
    const modal = document.getElementById('inspectorModal');
    if (!modal) {
        console.error("Inspector modal not found in HTML!");
        return;
    }

    // 1. Open the Modal immediately
    modal.classList.add('active');

    // 2. Safely extract Patient details and locate RMH MRN
    let patientName = "Unknown Patient";
    let patientGender = "N/A";
    let patientDob = "N/A";
    let patientMrn = fhirId; 

    if (patientBundle && patientBundle.entry && patientBundle.entry.length > 0) {
        const patientResource = patientBundle.entry[0].resource;
        
        if (patientResource.name && patientResource.name.length > 0) {
            const given = patientResource.name[0].given ? patientResource.name[0].given.join(' ') : '';
            const family = patientResource.name[0].family || '';
            patientName = `${given} ${family}`.trim();
        }
        patientGender = patientResource.gender || "N/A";
        patientDob = patientResource.birthDate || "N/A";

        if (patientResource.identifier && patientResource.identifier.length > 0) {
            const rmhIdentifier = patientResource.identifier.find(id => {
                if (!id.type) return false;
                const matchText = id.type.text && id.type.text.toUpperCase() === 'RMHMRN';
                const matchCoding = id.type.coding && id.type.coding.some(c => 
                    (c.code && c.code.toUpperCase() === 'RMHMRN') || 
                    (c.display && c.display.toUpperCase().includes('RMHMRN'))
                );
                return matchText || matchCoding;
            });

            if (rmhIdentifier && rmhIdentifier.value) {
                patientMrn = rmhIdentifier.value;
            } else {
                patientMrn = patientResource.identifier[0].value || fhirId;
            }
        }
    }

    // Populate UI Patient Header
    document.getElementById('ui-patient-name').textContent = patientName;
    document.getElementById('ui-patient-gender').textContent = patientGender;
    document.getElementById('ui-patient-dob').textContent = patientDob;
    document.getElementById('ui-patient-mrn').textContent = patientMrn;

    // 3. Process Encounters
    const encountersList = document.getElementById('ui-encounters-list');
    if (encounterBundle && encounterBundle.entry && encounterBundle.entry.some(e => e.resource && e.resource.resourceType === 'Encounter')) {
        encountersList.innerHTML = encounterBundle.entry
            .filter(e => e.resource && e.resource.resourceType === 'Encounter')
            .map(e => {
                let encounterType = 'N/A';
                if (e.resource.type && e.resource.type.length > 0) {
                    const t = e.resource.type[0];
                    if (t.coding && t.coding.length > 0 && t.coding[0].display) {
                        encounterType = t.coding[0].display;
                    } else if (t.text) {
                        encounterType = t.text;
                    } else if (t.coding && t.coding.length > 0 && t.coding[0].code) {
                        encounterType = t.coding[0].code;
                    }
                }

                let displayId = e.resource.id || 'N/A';
                if (e.resource.identifier && e.resource.identifier.length > 0) {
                    const extractedValues = e.resource.identifier.map(id => id.value).filter(val => val);
                    if (extractedValues.length > 0) displayId = extractedValues.join(', ');
                }

                return `
                    <div class="encounter-card">
                        <p><strong>Encounter ID:</strong> ${displayId}</p>
                        <p><strong>Type:</strong> ${encounterType}</p>
                        <p><strong>Status:</strong> ${e.resource.status || 'N/A'}</p>
                    </div>
                `;
            }).join('');
    } else {
        encountersList.innerHTML = '<p>No encounter records found in this bundle.</p>';
    }

    // 4. Process Episodes of Care (Episode ID excluded per previous refinement)
    const episodesList = document.getElementById('ui-episodes-list');
    if (encounterBundle && encounterBundle.entry && encounterBundle.entry.some(e => e.resource && e.resource.resourceType === 'EpisodeOfCare')) {
        episodesList.innerHTML = encounterBundle.entry
            .filter(e => e.resource && e.resource.resourceType === 'EpisodeOfCare')
            .map(e => {
                let episodeType = 'N/A';
                if (e.resource.type && e.resource.type.length > 0) {
                    const t = e.resource.type[0];
                    if (t.coding && t.coding.length > 0 && t.coding[0].display) {
                        episodeType = t.coding[0].display;
                    } else if (t.text) {
                        episodeType = t.text;
                    } else if (t.coding && t.coding.length > 0 && t.coding[0].code) {
                        episodeType = t.coding[0].code;
                    }
                }

                return `
                    <div class="episode-card">
                        <p><strong>Type:</strong> ${episodeType}</p>
                        <p><strong>Status:</strong> ${e.resource.status || 'N/A'}</p>
                    </div>
                `;
            }).join('');
    } else {
        episodesList.innerHTML = '<p>No Episode of Care records found in this bundle.</p>';
    }

    // 5. Render Raw JSON
    document.getElementById('ui-raw-json').textContent = JSON.stringify(encounterBundle, null, 2);
}

// Global UI helper functions for the Modal
window.switchInspectorTab = function(tabId, event) {
    document.querySelectorAll('#inspectorModal .tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('#inspectorModal .nav-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabId).classList.add('active');
    event.currentTarget.classList.add('active');
};

window.closeInspectorModal = function() {
    const modal = document.getElementById('inspectorModal');
    if (modal) {
        modal.classList.remove('active');
    }
};

// js/json-inspect-window.js

function openReferralInspectorWindow(titleText, fhirId, encounterBundle, patientBundle) {
    // 1. Open a separate, independent browser window
    const inspectorWindow = window.open('', '_blank', 'width=950,height=750,scrollbars=yes,resizable=yes');
    
    if (!inspectorWindow) {
        alert("Pop-up blocked! Please allow pop-ups for this site to view the referral details.");
        return;
    }

    // 2. Safely extract Patient details and locate the specific RMHMRN identifier
    let patientName = "Unknown Patient";
    let patientGender = "N/A";
    let patientDob = "N/A";
    let patientMrn = fhirId; // Default fallback

    if (patientBundle && patientBundle.entry && patientBundle.entry.length > 0) {
        const patientResource = patientBundle.entry[0].resource;
        
        // Extract Name
        if (patientResource.name && patientResource.name.length > 0) {
            const given = patientResource.name[0].given ? patientResource.name[0].given.join(' ') : '';
            const family = patientResource.name[0].family || '';
            patientName = `${given} ${family}`.trim();
        }
        patientGender = patientResource.gender || "N/A";
        patientDob = patientResource.birthDate || "N/A";

        // Extract RMHMRN by checking the identifier type (text or coding)
        if (patientResource.identifier && patientResource.identifier.length > 0) {
            const rmhIdentifier = patientResource.identifier.find(id => {
                if (!id.type) return false;

                // Check if type.text matches 'RMHMRN'
                const matchText = id.type.text && id.type.text.toUpperCase() === 'RMHMRN';

                // Check if any coding code or display matches 'RMHMRN'
                const matchCoding = id.type.coding && id.type.coding.some(c => 
                    (c.code && c.code.toUpperCase() === 'RMHMRN') || 
                    (c.display && c.display.toUpperCase().includes('RMHMRN'))
                );

                return matchText || matchCoding;
            });

            if (rmhIdentifier && rmhIdentifier.value) {
                patientMrn = rmhIdentifier.value;
            } else {
                // Fallback to the first available identifier value or original fhirId
                patientMrn = patientResource.identifier[0].value || fhirId;
            }
        }
    }

    // 3. Build the HTML layout for the separate window
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>${titleText}</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    margin: 0;
                    padding: 20px;
                    background-color: #f4f7f6;
                    color: #333;
                }
                .header-banner {
                    background: linear-gradient(135deg, #007bff, #0056b3);
                    color: white;
                    padding: 20px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                }
                .header-banner h2 {
                    margin: 0 0 10px 0;
                    font-size: 22px;
                }
                .patient-info-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 10px;
                    font-size: 16px;
                }
                .nav-tabs {
                    display: flex;
                    list-style: none;
                    padding: 0;
                    margin: 0 0 20px 0;
                    border-bottom: 2px solid #ddd;
                }
                .nav-item {
                    padding: 10px 20px;
                    cursor: pointer;
                    font-weight: bold;
                    color: #555;
                    border-bottom: 2px solid transparent;
                    margin-bottom: -2px;
                }
                .nav-item.active {
                    color: #007bff;
                    border-bottom: 2px solid #007bff;
                }
                .tab-pane {
                    display: none;
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.05);
                }
                .tab-pane.active {
                    display: block;
                }
                pre {
                    background: #1e1e1e;
                    color: #dcdcdc;
                    padding: 15px;
                    border-radius: 6px;
                    overflow-x: auto;
                    font-size: 13px;
                }
                .encounter-card {
                    background: #f8f9fa;
                    border-left: 4px solid #007bff;
                    padding: 12px 15px;
                    margin-bottom: 10px;
                    border-radius: 4px;
                }
                .episode-card {
                    background: #f8f9fa;
                    border-left: 4px solid #28a745;
                    padding: 12px 15px;
                    margin-bottom: 10px;
                    border-radius: 4px;
                }
                .section-header {
                    margin-top: 30px;
                    margin-bottom: 15px;
                    border-bottom: 1px solid #ddd;
                    padding-bottom: 5px;
                }
            </style>
        </head>
        <body>
            <div class="header-banner">
                <h2>Referral info</h2>
                <div class="patient-info-grid">
                    <div><strong>Patient Name:</strong> ${patientName}</div>
                    <div><strong>Gender:</strong> ${patientGender}</div>
                    <div><strong>DOB:</strong> ${patientDob}</div>
                    <div><strong>RMH MRN:</strong> ${patientMrn}</div>
                </div>
            </div>

            <ul class="nav-tabs">
                <li class="nav-item active" onclick="switchTab('encounters-tab', event)">Encounters & Episodes</li>
                <li class="nav-item" onclick="switchTab('raw-json-tab', event)">Raw JSON Bundle</li>
            </ul>

            <div id="encounters-tab" class="tab-pane active">
                
                <h3 class="section-header">Associated Encounter</h3>
                ${
                    encounterBundle && encounterBundle.entry && encounterBundle.entry.some(e => e.resource && e.resource.resourceType === 'Encounter')
                        ? encounterBundle.entry
                            .filter(e => e.resource && e.resource.resourceType === 'Encounter')
                            .map(e => {
                                //Extract Encounter Type 
                                let encounterType = 'N/A';
                                if (e.resource.type && e.resource.type.length > 0) {
                                    const t = e.resource.type[0];
                                    
                                    if (t.coding && t.coding.length > 0 && t.coding[0].display) {
                                        encounterType = t.coding[0].display; // Display  encounter -> type -> coding -> display
                                    }    
                                    //} else if (t.text) {
                                       // encounterType = t.text; // 2nd Choice: Raw root text
                                    //} else if (t.coding && t.coding.length > 0 && t.coding[0].code) {
                                        //encounterType = t.coding[0].code; // 3rd Choice: The raw terminology code
                                    //}
                                }

                                let displayId = e.resource.id || 'N/A';
                                if (e.resource.identifier && e.resource.identifier.length > 0) {
                                    const extractedValues = e.resource.identifier.map(id => id.value).filter(val => val);
                                    if (extractedValues.length > 0) displayId = extractedValues.join(', ');
                                }

                                let practitioner = e.resource.id || 'N/A';

                                if (e.resource.participant && e.resource.participant.length > 0) {
                                    const p = e.resource.participant[0];

                                    // Access the individual object and extract the display text
                                    if (p.individual && p.individual.display) {
                                        practitioner = p.individual.display;
                                    }
                                }
                                return `
                                    <div class="encounter-card">
                                        <p><strong>CNS:</strong> ${displayId}</p>
                                        <p><strong>Type:</strong> ${encounterType}</p>
                                        <p><strong>Status:</strong> ${e.resource.status || 'N/A'}</p>
                                        <p><strong>Clinician:</strong> ${practitioner}</p>
                                    </div>
                                `;
                            }).join('')
                        : '<p>No encounter records found in this bundle.</p>'
                }

                <h3 class="section-header">Episodes of Care</h3>
                ${
                    encounterBundle && encounterBundle.entry && encounterBundle.entry.some(e => e.resource && e.resource.resourceType === 'EpisodeOfCare')
                        ? encounterBundle.entry
                            .filter(e => e.resource && e.resource.resourceType === 'EpisodeOfCare')
                            .map(e => {
                                // Extract Episode Type
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
                            }).join('')
                        : '<p>No Episode of Care records found in this bundle.</p>'
                }

            </div>

            <div id="raw-json-tab" class="tab-pane">
                <h3>Full FHIR Bundle Payload</h3>
                <pre>${JSON.stringify(encounterBundle, null, 2)}</pre>
            </div>

            <script>
                function switchTab(tabId, event) {
                    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
                    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
                    
                    document.getElementById(tabId).classList.add('active');
                    event.currentTarget.classList.add('active');
                }
            </script>
        </body>
        </html>
    `;

    inspectorWindow.document.write(htmlContent);
    inspectorWindow.document.close();
}

const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(process.cwd(), 'api', 'logic.json'); 
let compiledLogicJson;

try {
  compiledLogicJson = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  compiledLogicJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'logic.json'), 'utf8'));
}

export default async function handler(req, res) {
  // CORS setup
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  try {
    const { patientBundle, encounterBundle, patientId } = req.body;

    if (!patientBundle || !encounterBundle || !patientId) {
        return res.status(400).json({ error: 'Missing patientBundle, encounterBundle, or patientId.' });
    }

    // 1. Manually extract raw resources to strip away Epic's searchset wrappers
    const allResources = [];
    
    if (patientBundle.entry) {
        patientBundle.entry.forEach(e => { if (e.resource) allResources.push(e.resource); });
    }
    
    if (encounterBundle.entry) {
        encounterBundle.entry.forEach(e => { if (e.resource) allResources.push(e.resource); });
    }

    // 2. Hard-validate the Patient resource exists
    const patientResources = allResources.filter(r => r.resourceType === 'Patient');
    
    if (patientResources.length === 0) {
        // If this triggers, it tells us exactly what resources WERE parsed
        const foundTypes = [...new Set(allResources.map(r => r.resourceType))].join(', ');
        return res.status(422).json({ 
            success: false, 
            error: `Backend stripped wrappers but found NO 'Patient' resource. Resources found: [${foundTypes}]` 
        });
    }

    // 3. Construct a pristine collection bundle guaranteed to parse in cql-exec-fhir
    const pristineBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: allResources.map(r => ({ resource: r }))
    };

    // 4. Initialize engine
    const library = new cql.Library(compiledLogicJson);
    const executor = new cql.Executor(library);
    const patientSource = cqlfhir.PatientSource.FHIRv401();

    // 5. Load the pristine bundle natively
    patientSource.loadBundles([pristineBundle]);
    const results = executor.exec(patientSource);
    
    // 6. Safely extract results
    const availablePatientKeys = Object.keys(results?.patientResults || results || {});
    const patientResults = results?.patientResults?.[patientId] || results?.[patientId];

    if (!patientResults) {
        return res.status(422).json({ 
            success: false, 
            error: `Engine executed but found no calculation for patientId: ${patientId}. Keys found: [${availablePatientKeys.join(', ')}]. Patient IDs in bundle: [${patientResources.map(p=>p.id).join(', ')}]` 
        });
    }

    // 7. Look up your boolean statement exactly as named in the CQL
    const qualifiesForQueue = patientResults["Is Valid Referral Triage Process"] === true;

    return res.status(200).json({
        success: true,
        actionRequired: qualifiesForQueue,
        queueItem: qualifiesForQueue ? {
            id: `idx-${Date.now()}`,
            patientId: patientId,
            timestamp: new Date().toISOString(),
            status: "Pending Action",
            details: "Referral criteria matched via local ELM JSON execution."
        } : null
    });

  } catch (error) {
    console.error("CQL Runtime Engine Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
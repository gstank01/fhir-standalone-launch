const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const fs = require('fs');
const path = require('path');

// Dynamically resolve absolute path for the Vercel execution context
const jsonPath = path.join(process.cwd(), 'api', 'logic.json'); 
let compiledLogicJson;

try {
  const rawData = fs.readFileSync(jsonPath, 'utf8');
  compiledLogicJson = JSON.parse(rawData);
} catch (e) {
  // Fallback if your file sits in the root instead of the api/ folder
  const rootPath = path.join(process.cwd(), 'logic.json');
  compiledLogicJson = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
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
        return res.status(400).json({ 
            error: 'Missing patientBundle, encounterBundle, or patientId.' 
        });
    }

    const library = new cql.Library(compiledLogicJson);
    const executor = new cql.Executor(library);
    const patientSource = cqlfhir.PatientSource.FHIRv401();

    // 🚀 The engine natively correlates resources across multiple bundles
    patientSource.loadBundles([patientBundle, encounterBundle]);

    const results = executor.exec(patientSource);
    
    const availablePatientKeys = Object.keys(results?.patientResults || results || {});
    console.log("[CQL Backend] Patient IDs registered in engine execution results:", availablePatientKeys);

    // Safely extract results whether the engine returns a nested object or a direct map
    const patientResults = results?.patientResults?.[patientId] || results?.[patientId];

    if (!patientResults) {
        return res.status(422).json({ 
            success: false, 
            error: `CQL engine found no results for patientId: ${patientId}. Keys found: [${availablePatientKeys.join(', ')}]` 
        });
    }

    // Look up your boolean statement exactly as named in the CQL
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
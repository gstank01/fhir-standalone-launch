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
  const rootPath = path.join(process.cwd(), 'logic.json');
  compiledLogicJson = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  try {
    const { fhirBundle, patientId } = req.body;
    if (!fhirBundle || !patientId) {
      return res.status(400).json({ error: 'Missing fhirBundle or patientId.' });
    }

    console.log(`[CQL Backend] Evaluating for target patientId: ${patientId}`);
    console.log(`[CQL Backend] Bundle entry count: ${fhirBundle.entry ? fhirBundle.entry.length : 0}`);

    // 2. Initialize the Library directly using your pre-compiled JSON blueprint
    const library = new cql.Library(compiledLogicJson);
    
    // 3. Initialize the runtime Execution runner environment
    const executor = new cql.Executor(library);

    // 4. Initialize the compatible FHIR R4 data model provider
    const patientSource = cqlfhir.PatientSource.FHIRv401(); 
    patientSource.loadBundles([fhirBundle]);

    // 5. Run evaluation across your patient source bundle records
    const results = executor.exec(patientSource);

    // DEBUG LOG: Print all patient keys recognized by the CQL engine
    const availablePatientKeys = Object.keys(results?.patientResults || results || {});
    console.log("[CQL Backend] Patient IDs registered in engine execution results:", availablePatientKeys);

    const patientResults = results?.patientResults?.[patientId] || results?.[patientId];

    if (!patientResults) {
      return res.status(422).json({ 
        success: false, 
        error: `No calculation found for patientId: ${patientId}. Engine found keys: [${availablePatientKeys.join(', ')}].` 
      });
    }

    // 6. Look up the calculation flag directly from your final rule name
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
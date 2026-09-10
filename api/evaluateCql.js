const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');

// 1. Load the pre-compiled ELM JSON file directly from your local directory
const compiledLogicJson = require('./logic.json');

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

    // 2. Initialize the Library directly using your pre-compiled JSON blueprint
    const library = new cql.Library(compiledLogicJson);
    
    // 3. Initialize the runtime Execution runner environment
    const executor = new cql.Executor(library);

    // 4. Initialize the compatible FHIR R4 data model provider
    const patientSource = cqlfhir.PatientSource.FHIRv401(); 
    patientSource.loadBundles([fhirBundle]);

    // 5. Run evaluation across your patient source bundle records
    const results = executor.exec(patientSource);
    const patientResults = results.patientResults[patientId];

    if (!patientResults) {
      return res.status(404).json({ 
        success: false, 
        error: `No calculation found for patientId: ${patientId}.` 
      });
    }

    // 6. Look up the calculation flag directly from your final rule name
    const qualifiesForQueue = patientResults["Is Valid Referral Triage Process"] === true;

    // Return the calculated status and data back directly to the caller
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

const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const referralLogic = require('../logic.json'); 

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

    const library = new cql.Library(referralLogic);
    const executor = new cql.Context(library, new cql.CodeService());

    const patientSource = new cqlfhir.PatientSource(); 
    patientSource.loadBundles([fhirBundle]);
    executor.setProvider('FHIR', patientSource);

    const results = executor.read();
    const patientResults = results.patientResults[patientId];
    const qualifiesForQueue = patientResults["Meets Referral Criteria"] === true;

    // Return the calculated status and data back directly to the caller
    return res.status(200).json({
      success: true,
      actionRequired: qualifiesForQueue,
      queueItem: qualifiesForQueue ? {
        id: `idx-${Date.now()}`,
        patientId: patientId,
        timestamp: new Date().toISOString(),
        status: "Pending Action",
        // Extract basic details from the incoming bundle to display in your HTML table
        details: "Referral criteria matched via CQL evaluation."
      } : null
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

//this will trigger the evaluation of the CQL and return the results to the client

const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const referralLogic = require('../logic.json'); // Your compiled referral ELM JSON

export default async function handler(req, res) {
  // 1. Enforce CORS so your HTML frontend can safely communicate with this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight browser requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  try {
    const { fhirBundle, patientId } = req.body;

    if (!fhirBundle || !patientId) {
      return res.status(400).json({ error: 'Missing fhirBundle or patientId in request body.' });
    }

    // 2. Initialize the CQL library
    const library = new cql.Library(referralLogic);
    
    // For production, you can populate this CodeService with explicit mapping tables
    const codeService = new cql.CodeService(); 
    const executor = new cql.Context(library, codeService);

    // 3. Robust, serverless-safe initialization of the FHIR data engine
    const patientSource = new cqlfhir.PatientSource(); 
    patientSource.loadBundles([fhirBundle]);
    executor.setProvider('FHIR', patientSource);

    // 4. Run the evaluation logic against the dataset
    const results = executor.read();
    const patientResults = results.patientResults[patientId];

    // 5. Audit-trail logging: capture the exact output of your criteria rules
    const qualifiesForQueue = patientResults["Meets Referral Criteria"] === true;

    // 6. Conditional Routing Pipeline
    if (qualifiesForQueue) {
      return res.status(200).json({
        success: true,
        actionRequired: true,
        timestamp: new Date().toISOString(),
        routingData: {
          patientId: patientId,
          status: "pending_review",
          logicVersion: referralLogic.library.identifier.version || "1.0.0",
          justification: "Patient criteria matched 'Meets Referral Criteria' configuration rule."
        }
      });
    }

    // If criteria is not met, return clean status without clogging your app queue
    return res.status(200).json({
      success: true,
      actionRequired: false,
      timestamp: new Date().toISOString(),
      routingData: {
        patientId: patientId,
        status: "ignored",
        justification: "Patient does not match specific referral guidelines."
      }
    });

  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

const crypto = require('crypto');
const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const { neon } = require('@neondatabase/serverless'); // Add Neon driver

let cachedLibrary = null;

// This function is now async because it queries the database
async function getLibrary() {
  if (cachedLibrary) return cachedLibrary;

  const sql = neon(process.env.DATABASE_URL);

  // Fetch both libraries in a single query
  const records = await sql`
    SELECT library_name, elm_json 
    FROM cql_libraries 
    WHERE library_name IN ('logic', 'FHIRHelpers')
  `;

  if (records.length < 2) {
    throw new Error('Missing CQL libraries in the database. Ensure both "logic" and "FHIRHelpers" are inserted.');
  }

  const compiledLogicJson = records.find(r => r.library_name === 'logic').elm_json;
  const fhirHelpersJson = records.find(r => r.library_name === 'FHIRHelpers').elm_json;

  const repository = new cql.Repository({ FHIRHelpers: fhirHelpersJson });
  cachedLibrary = new cql.Library(compiledLogicJson, repository);
  
  return cachedLibrary;
}

// ... (Keep your buildPristineBundle and summarizeBundle functions here) ...

// Make this function async so it can await the database call
async function runReferralTriageCql(pristineBundle) {
  console.log('CQL: merged bundle resource counts:', summarizeBundle(pristineBundle));

  // Await the library from the database
  const library = await getLibrary();
  const executor = new cql.Executor(library);

  const executionSource = cqlfhir.PatientSource.FHIRv400();
  executionSource.loadBundles([pristineBundle]);

  const results = executor.exec(executionSource);
  const rawResultsContainer = results?.patientResults || results || {};
  const availablePatientKeys = Object.keys(rawResultsContainer);
  console.log('CQL: exec() returned patient keys:', availablePatientKeys);

  let loadedPatientId = null;
  try {
    const diagSource = cqlfhir.PatientSource.FHIRv400();
    diagSource.loadBundles([pristineBundle]);
    const diagPatient = diagSource.currentPatient();
    loadedPatientId = diagPatient ? diagPatient.getId() : null;
  } catch (diagErr) {
    console.error('CQL: diagnostic patient check threw:', diagErr);
  }

  return { loadedPatientId, availablePatientKeys, rawResultsContainer };
}

// ... (Keep getAccessToken and fhirGet as they are) ...

export default async function handler(req, res) {
  // ... (Keep CORS and input validation as they are) ...

  try {
    // ... (Keep FHIR querying logic as it is) ...

    const pristineBundle = buildPristineBundle([patientBundle, encounterBundle, episodeBundle]);
    
    // Remember to await runReferralTriageCql now
    const { loadedPatientId, availablePatientKeys, rawResultsContainer } = await runReferralTriageCql(pristineBundle);

    // ... (Keep evaluation extraction and return statement as they are) ...

  } catch (error) {
    console.error('CQL Runtime Engine Error:', error);
    return res.status(500).json({ success: false, error: `DEBUG: ${error.message}` });
  }
}
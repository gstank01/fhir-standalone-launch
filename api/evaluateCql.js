const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const fs = require('fs');
const path = require('path');

// -------------------------------------------------------------
// Dynamically resolve absolute path for Vercel execution context
// -------------------------------------------------------------

const jsonPath = path.join(
  process.cwd(),
  'api',
  'logic.json'
);

let compiledLogicJson;

try {
  const rawData = fs.readFileSync(
    jsonPath,
    'utf8'
  );

  compiledLogicJson = JSON.parse(rawData);

} catch (e) {

  const rootPath = path.join(
    process.cwd(),
    'logic.json'
  );

  compiledLogicJson = JSON.parse(
    fs.readFileSync(
      rootPath,
      'utf8'
    )
  );
}


// -------------------------------------------------------------
// API Handler
// -------------------------------------------------------------

export default async function handler(req, res) {

  // -----------------------------------------------------------
  // CORS
  // -----------------------------------------------------------

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Use POST.'
    });
  }


  // -----------------------------------------------------------
  // Main processing
  // -----------------------------------------------------------

  try {

    const {
      fhirBundle,
      patientBundle,
      encounterBundle,
      patientId
    } = req.body;


    // ---------------------------------------------------------
    // Validate and build bundle context
    // ---------------------------------------------------------

    let activeBundle = fhirBundle;

    if (!activeBundle && patientBundle && encounterBundle) {
      activeBundle = {
        resourceType: "Bundle",
        type: "collection",
        entry: [
          ...(patientBundle.entry || []),
          ...(encounterBundle.entry || [])
        ]
      };
    }

    if (!activeBundle || !patientId) {
      return res.status(400).json({
        error: 'Missing fhirBundle (or patientBundle/encounterBundle) or patientId.'
      });
    }


    console.log(
      `[CQL Backend] Target Patient ID: ${patientId}`
    );

    console.log(
      `[CQL Backend] Bundle entry count: ${
        activeBundle.entry
          ? activeBundle.entry.length
          : 0
      }`
    );


    // ---------------------------------------------------------
    // Extract resources from bundle
    // ---------------------------------------------------------

    const bundleResources = (
      activeBundle.entry || []
    )
      .map(entry => entry.resource)
      .filter(Boolean);


    // ---------------------------------------------------------
    // DEBUG:
    // Show resource types received
    // ---------------------------------------------------------

    console.log(
      '[CQL Backend] Resource types received:',
      bundleResources.map(
        resource => resource.resourceType
      )
    );


    // ---------------------------------------------------------
    // Find Patient resources
    // ---------------------------------------------------------

    const patientResources = bundleResources
      .filter(
        resource =>
          resource.resourceType === 'Patient'
      )
      .map(
        resource => ({
          resourceType: resource.resourceType,
          id: resource.id
        })
      );


    // ---------------------------------------------------------
    // Find Encounter resources
    // ---------------------------------------------------------

    const encounterResources = bundleResources
      .filter(
        resource =>
          resource.resourceType === 'Encounter'
      )
      .map(
        resource => ({
          resourceType: resource.resourceType,
          id: resource.id
        })
      );


    console.log(
      '[CQL Backend] Patient resources received:',
      patientResources
    );

    console.log(
      '[CQL Backend] Encounter resources received:',
      encounterResources
    );


    // ---------------------------------------------------------
    // Confirm target Patient exists in bundle
    // ---------------------------------------------------------

    const matchingPatient = patientResources.find(
      patient =>
        patient.id === patientId
    );


    if (!matchingPatient) {

      console.error(
        `[CQL Backend] Patient ID ${patientId} ` +
        `was NOT found in the supplied bundle.`
      );

      return res.status(422).json({
        success: false,

        error:
          `Patient ID ${patientId} was not found ` +
          `in the supplied FHIR bundle.`,

        patientIdsInBundle:
          patientResources.map(
            patient => patient.id
          )
      });
    }


    console.log(
      `[CQL Backend] Confirmed ` +
      `Patient/${patientId} exists in bundle.`
    );


    // ---------------------------------------------------------
    // Initialize the CQL Library
    // ---------------------------------------------------------

    const library = new cql.Library(
      compiledLogicJson
    );


    // ---------------------------------------------------------
    // Initialize CQL Executor
    // ---------------------------------------------------------

    const executor = new cql.Executor(
      library
    );


    // ---------------------------------------------------------
    // Initialize FHIR R4 data provider
    // ---------------------------------------------------------

    const patientSource =
      cqlfhir.PatientSource.FHIRv401();


    // ---------------------------------------------------------
    // Load Bundle into FHIR PatientSource
    // ---------------------------------------------------------

    patientSource.loadBundles([
      activeBundle
    ]);


    console.log(
      '[CQL Backend] Bundle loaded into FHIR PatientSource.'
    );


    // ---------------------------------------------------------
    // Execute CQL
    // ---------------------------------------------------------

    const results =
      executor.exec(patientSource);


    // ---------------------------------------------------------
    // DEBUG:
    // Print COMPLETE CQL execution result
    // ---------------------------------------------------------

    console.log(
      '[CQL Backend] Full execution result:',
      JSON.stringify(
        results,
        null,
        2
      )
    );


    // ---------------------------------------------------------
    // DEBUG:
    // Identify available patient keys
    // ---------------------------------------------------------

    const availablePatientKeys =
      Object.keys(
        results?.patientResults ||
        results ||
        {}
      );


    console.log(
      '[CQL Backend] Patient IDs registered ' +
      'in engine execution results:',
      availablePatientKeys
    );


    // ---------------------------------------------------------
    // Look up calculation for target patient (safe fallback)
    // ---------------------------------------------------------

    const patientResults =
      results?.patientResults?.[patientId] ||
      results?.[patientId];


    // ---------------------------------------------------------
    // No result found
    // ---------------------------------------------------------

    if (!patientResults) {

      return res.status(422).json({

        success: false,

        error:
          `No calculation found for patientId: ` +
          `${patientId}. ` +
          `Engine found keys: [` +
          `${availablePatientKeys.join(', ')}` +
          `].`

      });
    }


    // ---------------------------------------------------------
    // Check final CQL expression
    // ---------------------------------------------------------

    const qualifiesForQueue =
      patientResults[
        "Is Valid Referral Triage Process"
      ] === true;


    console.log(
      `[CQL Backend] ` +
      `Is Valid Referral Triage Process = ` +
      `${qualifiesForQueue}`
    );


    // ---------------------------------------------------------
    // Successful response
    // ---------------------------------------------------------

    return res.status(200).json({

      success: true,

      actionRequired:
        qualifiesForQueue,

      queueItem:
        qualifiesForQueue
          ? {
              id: `idx-${Date.now()}`,

              patientId: patientId,

              timestamp:
                new Date().toISOString(),

              status:
                "Pending Action",

              details:
                "Referral criteria matched " +
                "via local ELM JSON execution."
            }

          : null

    });


  } catch (error) {

    // ---------------------------------------------------------
    // Runtime error
    // ---------------------------------------------------------

    console.error(
      "[CQL Runtime Engine Error]",
      error
    );


    return res.status(500).json({

      success: false,

      error: error.message

    });

  }
}
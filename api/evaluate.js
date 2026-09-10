const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');

// 1. Paste your raw, human-readable CQL script directly as a string variable
const rawCqlScript = `
library ReferralTriageLogic version '1.0.0'
using FHIR version '4.0.1'
include FHIRHelpers version '4.0.1' called FHIRHelpers

context Patient

codesystem "HospitalCodes": 'urn:oid:1.2.840.114350.1.13.520.3.7.10.698084.30'
code "Referral Triage Code": '2611' from "HospitalCodes" display 'Referral Triage'

define "Referral Triage Encounters":
  [Encounter] E
    where exists (
      E.type T 
        where FHIRHelpers.ToConcept(T) ~ "Referral Triage Code"
    )

define "Active Episodes of Care":
  [EpisodeOfCare] Episode
    where Episode.status.value = 'active'

define "Is Valid Referral Triage Process":
  exists (
    "Referral Triage Encounters" ValidEncounter
      where exists (
        "Active Episodes of Care" ActiveEpisode
          where ValidEncounter.episodeOfCare.reference.value = 'EpisodeOfCare/' + ActiveEpisode.id.value
      )
  )
`;

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

    // 2. Convert raw CQL string into ELM JSON on the fly using the official HL7 OpenCDS endpoint
    console.log("[CQL Engine] Sending raw script to OpenCDS for dynamic compilation...");
    const translatorResponse = await fetch('https://opencds.org', {
      method: 'POST',
      headers: {
        'Accept': 'application/elm+json',
        'Content-Type': 'text/plain'
      },
      body: rawCqlScript
    });

    if (!translatorResponse.ok) {
      const errorMsg = await translatorResponse.text();
      throw new Error(`ELM Compilation failed via OpenCDS: ${errorMsg}`);
    }

    const compiledLogicJson = await translatorResponse.json();

    // 3. Initialize the Library using the runtime-compiled JSON blueprint
    const library = new cql.Library(compiledLogicJson);
    
    // 4. Initialize the runtime Execution runner environment (v3 compatible)
    const executor = new cql.Executor(library);

    // 5. Initialize the compatible FHIR R4 data model provider (v2 compatible)
    const patientSource = cqlfhir.PatientSource.FHIRv401(); 
    patientSource.loadBundles([fhirBundle]);

    // 6. Run evaluation across your patient source bundle records
    const results = executor.exec(patientSource);
    const patientResults = results.patientResults[patientId];

    if (!patientResults) {
      return res.status(404).json({ 
        success: false, 
        error: `No calculation found for patientId: ${patientId}.` 
      });
    }

    // 7. Look up the calculation flag directly from your text script's final rule
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
        details: "Referral criteria matched via live OpenCDS CQL execution."
      } : null
    });

  } catch (error) {
    console.error("CQL Runtime Engine Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

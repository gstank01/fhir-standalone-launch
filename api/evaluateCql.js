const cql = require('cql-execution');
const cqlfhir = require('cql-exec-fhir');
const fs = require('fs');
const path = require('path');

// --- Load compiled CQL ELM + its dependency libraries once, at module load ---
function loadJsonRelativeToApi(filename) {
  const primary = path.join(process.cwd(), 'api', filename);
  const fallback = path.join(process.cwd(), filename);
  const target = fs.existsSync(primary) ? primary : fallback;
  return JSON.parse(fs.readFileSync(target, 'utf8'));
}

const compiledLogicJson = loadJsonRelativeToApi('logic.json');

// FHIRHelpers.json is the compiled ELM for FHIRHelpers.cql (version 4.0.1),
// produced by the same CQL-to-ELM translator run that produced logic.json.
// logic.json's "includes" section references FHIRHelpers, and statements
// like "Referral Triage Encounters" call FHIRHelpers.ToConcept directly.
// Without handing this library to cql-execution via a Repository, that
// FunctionRef can't be resolved and the engine will not produce results.
//
// If you don't have this file yet: run your ReferralTriageLogic.cql through
// the CQL-to-ELM translator with FHIRHelpers.cql on the include path, and
// copy the resulting FHIRHelpers.json next to logic.json.
const fhirHelpersJson = loadJsonRelativeToApi('FHIRHelpers.json');

const repository = new cql.Repository({ FHIRHelpers: fhirHelpersJson });
const library = new cql.Library(compiledLogicJson, repository);

/**
 * Merge one or more raw FHIR Bundles (Patient search results, Encounter
 * search results, EpisodeOfCare search results, etc.) representing a single
 * patient into one "collection" Bundle that cql-exec-fhir's PatientSource
 * can load.
 */
function buildPristineBundle(bundles) {
  const allEntries = [];

  bundles.forEach(bundle => {
    if (!bundle || !bundle.entry) return;
    bundle.entry.forEach(entry => {
      if (!entry.resource) return;
      // cql-exec-fhir relies on fullUrl for internal linking between
      // resources; force one if the source server omitted it.
      if (!entry.fullUrl) {
        entry.fullUrl = `${entry.resource.resourceType}/${entry.resource.id}`;
      }
      allEntries.push(entry);
    });
  });

  const hasPatient = allEntries.some(e => e.resource.resourceType === 'Patient');
  if (!hasPatient) {
    const foundTypes = [...new Set(allEntries.map(e => e.resource.resourceType))].join(', ');
    throw new Error(`Merged bundle has no Patient resource. Resource types present: [${foundTypes}]`);
  }

  return { resourceType: 'Bundle', type: 'collection', entry: allEntries };
}

/**
 * Runs the compiled ReferralTriageLogic CQL against a single pristine FHIR
 * Bundle (one patient's worth of merged resources).
 */
function runReferralTriageCql(pristineBundle) {
  const executor = new cql.Executor(library);
  const patientSource = cqlfhir.PatientSource.FHIRv400();

  patientSource.loadBundles([pristineBundle]);

  // PatientSource does not expose a public "list loaded patient ids" method
  // (there is no sortedPatientIds()) - currentPatient()/nextPatient() is the
  // only supported way to inspect what got loaded. exec() below consumes
  // that same iterator, so we reset it after this one-time sanity check.
  const loadedPatient = patientSource.currentPatient();
  const loadedPatientId = loadedPatient ? loadedPatient.getId() : null;
  patientSource.reset();

  const results = executor.exec(patientSource);
  const rawResultsContainer = results?.patientResults || results || {};
  const availablePatientKeys = Object.keys(rawResultsContainer);

  return { loadedPatientId, availablePatientKeys, rawResultsContainer };
}

module.exports = { buildPristineBundle, runReferralTriageCql };

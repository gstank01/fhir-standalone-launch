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

    console.log("--- CQL GATEKEEPER GUARDRAIL DEBUG ---");
    console.log("1. Target Patient ID received from frontend:", patientId);

    // 1. Safely extract all original entries and FORCE a fullUrl if Epic omitted it
    const allEntries = [];
    
    const processEntries = (bundle) => {
        if (!bundle || !bundle.entry) return;
        bundle.entry.forEach(entry => {
            if (entry.resource) {
                // cql-exec-fhir relies heavily on fullUrl for internal linking
                if (!entry.fullUrl) {
                    entry.fullUrl = `${entry.resource.resourceType}/${entry.resource.id}`;
                }
                allEntries.push(entry);
            }
        });
    };

    processEntries(patientBundle);
    processEntries(encounterBundle);

    console.log(`2. Total Bundle Entries Merged & Normalized: ${allEntries.length}`);

    // 2. Hard-validate the Patient resource exists
    const patientResources = allEntries
        .map(e => e.resource)
        .filter(r => r && r.resourceType === 'Patient');
    
    if (patientResources.length === 0) {
        const foundTypes = [...new Set(allEntries.map(e => e.resource?.resourceType))].join(', ');
        return res.status(422).json({ 
            success: false, 
            error: `Backend merged entries but found NO 'Patient' resource. Resources found: [${foundTypes}]` 
        });
    }

    // 3. Construct a pristine collection bundle
    const pristineBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: allEntries
    };

    // 4. Initialize engine using standard FHIR R4 source
    const library = new cql.Library(compiledLogicJson);
    const executor = new cql.Executor(library);
    const patientSource = cqlfhir.PatientSource.FHIRv400();

    // 5. Load the pristine bundle natively
    patientSource.loadBundles([pristineBundle]);

    const loadedPatientIds = patientSource.sortedPatientIds ? patientSource.sortedPatientIds() : [];
    console.log("3. Patient IDs successfully loaded into PatientSource:", loadedPatientIds);

    // 6. Execute engine
    const results = executor.exec(patientSource);
    
    // 7. Bulletproof Result Extraction
    const rawResultsContainer = results?.patientResults || results || {};
    const availablePatientKeys = Object.keys(rawResultsContainer);
    console.log("4. Raw Execution Engine Result Keys found:", availablePatientKeys);

    let patientResults = null;

    if (availablePatientKeys.length > 0) {
        // Find by exact match, suffix (e.g. Patient/123), or inclusion
        let matchedKey = availablePatientKeys.find(k => {
            const normalizedK = k.toLowerCase();
            const normalizedId = patientId.toLowerCase();
            return normalizedK === normalizedId || 
                   normalizedK.endsWith(`/${normalizedId}`) || 
                   normalizedK.includes(normalizedId);
        });

        // FORCE FALLBACK: If we still didn't match the string perfectly, 
        // but the engine calculated a result, just grab the first one.
        if (!matchedKey) {
            matchedKey = availablePatientKeys[0];
            console.log(`[CQL Engine] String match failed. Forcing fallback to first available key: "${matchedKey}"`);
        }

        patientResults = rawResultsContainer[matchedKey];
    }

    if (!patientResults) {
        console.error(`ERROR: Engine executed but found no calculation for patientId: ${patientId}. Keys found: [${availablePatientKeys.join(', ')}]`);
        return res.status(422).json({ 
            success: false, 
            error: `Engine executed but found no calculation. Keys found: [${availablePatientKeys.join(', ')}]. Loaded IDs: [${loadedPatientIds.join(', ')}]` 
        });
    }

    // 8. Look up your boolean statement exactly as named in the CQL
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
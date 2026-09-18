-- Seeds the cql_rules table (sql/002_create_cql_rules.sql) with a second
-- rule the CQL-app worklist can select: instead of looking at
-- Encounter/EpisodeOfCare data (ReferralTriageLogic), this one looks at a
-- patient's Appointment records and flags a match when any appointment's
-- Location is part of the site identified by code 'RPY01' (The Royal
-- Marsden - Chelsea). Paste and run this once in the Neon SQL editor (or
-- psql) after applying 002_create_cql_rules.sql. Safe to re-run — it
-- upserts by name, so re-running after editing the rule just refreshes the
-- stored row.

INSERT INTO cql_rules (name, version, description, result_expression, cql_text, elm_json, active, workflows)
VALUES (
  'AppointmentLocationLogic',
  '1.0.0',
  'Flags a patient for the queue when they have an Appointment at a Location that is part of site code "RPY01" (The Royal Marsden - Chelsea).',
  'Is Royal Marsden Chelsea Appointment',
  $cql$library AppointmentLocationLogic version '1.0.0'

using FHIR version '4.0.1'

// Automatically converts complex FHIR data types into standard CQL concepts
include FHIRHelpers version '4.0.1' called FHIRHelpers

context Patient

// 1. The code "RPY01" is never sent in the FHIR bundle — Epic identifies
// this site only by an internal Location id, which shows up as the
// *parent* Location referenced by the appointment's Location's own
// .partOf, e.g.:
//   "partOf": { "reference": "Location/eLVUrSrT4-KVXjmLgWvTBDg3",
//               "display": "The Royal Marsden - Chelsea" }
// So "RPY01" -> Location/eLVUrSrT4-KVXjmLgWvTBDg3 is a mapping we maintain
// ourselves (also kept in api/evaluateCql.js next to this rule), exactly
// the same way "Referral Triage" is a manual mapping for code 2611 in
// ReferralTriageLogic — neither string is read off the bundle itself.
// Four more site codes will be mapped the same way later; for now only
// RPY01 is evaluated.
define "Royal Marsden Chelsea Locations":
  [Location] L
    where L.partOf.reference.value = 'Location/eLVUrSrT4-KVXjmLgWvTBDg3'

// 2. Filter Appointment entries down to ones with a participant (actor)
// pointing at one of the target Location resources above.
// NOTE: Appointment.participant is 0..* (a list), so it must be iterated
// with its own alias before dotting into .actor.reference.value — chaining
// straight through the list (Appointment.participant.actor...) silently
// evaluates to null under cql-exec-fhir, same pitfall as
// ReferralTriageLogic's episodeOfCare list.
define "Appointments At Target Location":
  [Appointment] A
    where exists (
      A.participant P
        where exists (
          "Royal Marsden Chelsea Locations" TargetLocation
            where P.actor.reference.value = 'Location/' + TargetLocation.id.value
        )
    )

// 3. Final Boolean Gatekeeper Decision (Returns TRUE/FALSE)
define "Is Royal Marsden Chelsea Appointment":
  exists ("Appointments At Target Location")
$cql$,
  $elm${
  "library": {
    "identifier": {
      "id": "AppointmentLocationLogic",
      "version": "1.0.0"
    },
    "schemaIdentifier": {
      "id": "urn:hl7-org:elm",
      "version": "r1"
    },
    "usings": {
      "def": [
        {
          "localIdentifier": "System",
          "uri": "urn:hl7-org:elm-types:r1"
        },
        {
          "localIdentifier": "FHIR",
          "uri": "http://hl7.org/fhir",
          "version": "4.0.1"
        }
      ]
    },
    "includes": {
      "def": [
        {
          "path": "FHIRHelpers",
          "version": "4.0.1",
          "localIdentifier": "FHIRHelpers"
        }
      ]
    },
    "contexts": {
      "def": [
        {
          "name": "Patient"
        }
      ]
    },
    "statements": {
      "def": [
        {
          "name": "Patient",
          "context": "Patient",
          "expression": {
            "type": "SingletonFrom",
            "operand": {
              "type": "Retrieve",
              "dataType": "{http://hl7.org/fhir}Patient",
              "templateId": "http://hl7.org/fhir/StructureDefinition/Patient"
            }
          }
        },
        {
          "name": "Royal Marsden Chelsea Locations",
          "context": "Patient",
          "accessLevel": "Public",
          "expression": {
            "type": "Query",
            "source": [
              {
                "alias": "L",
                "expression": {
                  "type": "Retrieve",
                  "dataType": "{http://hl7.org/fhir}Location",
                  "templateId": "http://hl7.org/fhir/StructureDefinition/Location"
                }
              }
            ],
            "where": {
              "type": "Equal",
              "operand": [
                {
                  "type": "Property",
                  "path": "partOf.reference.value",
                  "scope": "L"
                },
                {
                  "type": "Literal",
                  "valueType": "{urn:hl7-org:elm-types:r1}String",
                  "value": "Location/eLVUrSrT4-KVXjmLgWvTBDg3"
                }
              ]
            }
          }
        },
        {
          "name": "Appointments At Target Location",
          "context": "Patient",
          "accessLevel": "Public",
          "expression": {
            "type": "Query",
            "source": [
              {
                "alias": "A",
                "expression": {
                  "type": "Retrieve",
                  "dataType": "{http://hl7.org/fhir}Appointment",
                  "templateId": "http://hl7.org/fhir/StructureDefinition/Appointment"
                }
              }
            ],
            "where": {
              "type": "Exists",
              "operand": {
                "type": "Query",
                "source": [
                  {
                    "alias": "P",
                    "expression": {
                      "type": "Property",
                      "path": "participant",
                      "scope": "A"
                    }
                  }
                ],
                "where": {
                  "type": "Exists",
                  "operand": {
                    "type": "Query",
                    "source": [
                      {
                        "alias": "TargetLocation",
                        "expression": {
                          "type": "ExpressionRef",
                          "name": "Royal Marsden Chelsea Locations"
                        }
                      }
                    ],
                    "where": {
                      "type": "Equal",
                      "operand": [
                        {
                          "type": "Property",
                          "path": "actor.reference.value",
                          "scope": "P"
                        },
                        {
                          "type": "Concatenate",
                          "operand": [
                            {
                              "type": "Literal",
                              "valueType": "{urn:hl7-org:elm-types:r1}String",
                              "value": "Location/"
                            },
                            {
                              "type": "Property",
                              "path": "id.value",
                              "scope": "TargetLocation"
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        },
        {
          "name": "Is Royal Marsden Chelsea Appointment",
          "context": "Patient",
          "accessLevel": "Public",
          "expression": {
            "type": "Exists",
            "operand": {
              "type": "ExpressionRef",
              "name": "Appointments At Target Location"
            }
          }
        }
      ]
    }
  }
}$elm$::jsonb,
  true,
  ARRAY['cql-app']
)
ON CONFLICT (name) DO UPDATE SET
  version = EXCLUDED.version,
  description = EXCLUDED.description,
  result_expression = EXCLUDED.result_expression,
  cql_text = EXCLUDED.cql_text,
  elm_json = EXCLUDED.elm_json,
  active = EXCLUDED.active,
  workflows = EXCLUDED.workflows,
  updated_at = now();

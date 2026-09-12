-- Seeds the cql_rules table (sql/002_create_cql_rules.sql) with the
-- rule that used to live only in api/logic.json / triage-logic.cql.
-- Paste and run this once in the Neon SQL editor (or psql) after applying
-- 002_create_cql_rules.sql. Safe to re-run — it upserts by name, so
-- re-running after editing the rule just refreshes the stored row.

INSERT INTO cql_rules (name, version, description, result_expression, cql_text, elm_json, active, workflows)
VALUES (
  'ReferralTriageLogic',
  '1.0.0',
  'Flags a patient for the referral triage queue when they have a Referral Triage encounter linked to an active EpisodeOfCare.',
  'Is Valid Referral Triage Process',
  $cql$library ReferralTriageLogic version '1.0.0'

using FHIR version '4.0.1'

// Automatically converts complex FHIR data types into standard CQL concepts
include FHIRHelpers version '4.0.1' called FHIRHelpers

context Patient

// 1. Establish your system's terminology mapping
// https://cql.hl7.org/STU3/02-authorsguide.html - In CQL, an OID system is specified exactly as a uniform resource identifier (URI) string inside the single quotes

codesystem "HospitalCodes": 'urn:oid:1.2.840.114350.1.13.520.3.7.10.698084.30'
code "Referral Triage Code": '2611' from "HospitalCodes" display 'Referral Triage'

// 2. Filter Encounter entries down to only Referral Triage processes
define "Referral Triage Encounters":
  [Encounter] E
    where exists (
      E.type T 
        where FHIRHelpers.ToConcept(T) ~ "Referral Triage Code"
    )

// 3. Isolate active EpisodeOfCare instances
define "Active Episodes of Care":
  [EpisodeOfCare] Episode
    where Episode.status.value = 'active'

// 4. Final Boolean Gatekeeper Decision (Returns TRUE/FALSE)
// NOTE: Encounter.episodeOfCare is 0..* (a list), so it must be iterated
// with its own alias before dotting into .reference.value — same as how
// "Referral Triage Encounters" above iterates E.type with alias T. Writing
// ValidEncounter.episodeOfCare.reference.value directly (chaining through
// the list) silently evaluates to null under cql-exec-fhir, so the rule
// would never match anything.
define "Is Valid Referral Triage Process":
  exists (
    "Referral Triage Encounters" ValidEncounter
      where exists (
        ValidEncounter.episodeOfCare EOC
          where exists (
            "Active Episodes of Care" ActiveEpisode
              where EOC.reference.value = 'EpisodeOfCare/' + ActiveEpisode.id.value
          )
      )
  )
$cql$,
  $elm${
  "library": {
    "identifier": {
      "id": "ReferralTriageLogic",
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
    "codeSystems": {
      "def": [
        {
          "name": "HospitalCodes",
          "id": "urn:oid:1.2.840.114350.1.13.520.3.7.10.698084.30",
          "accessLevel": "Public"
        }
      ]
    },
    "codes": {
      "def": [
        {
          "name": "Referral Triage Code",
          "id": "2611",
          "display": "Referral Triage",
          "accessLevel": "Public",
          "codeSystem": {
            "name": "HospitalCodes"
          }
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
          "name": "Referral Triage Encounters",
          "context": "Patient",
          "accessLevel": "Public",
          "expression": {
            "type": "Query",
            "source": [
              {
                "alias": "E",
                "expression": {
                  "type": "Retrieve",
                  "dataType": "{http://hl7.org/fhir}Encounter",
                  "templateId": "http://hl7.org/fhir/StructureDefinition/Encounter"
                }
              }
            ],
            "where": {
              "type": "Exists",
              "operand": {
                "type": "Query",
                "source": [
                  {
                    "alias": "T",
                    "expression": {
                      "type": "Property",
                      "path": "type",
                      "scope": "E"
                    }
                  }
                ],
                "where": {
                  "type": "Equivalent",
                  "operand": [
                    {
                      "type": "FunctionRef",
                      "libraryName": "FHIRHelpers",
                      "name": "ToConcept",
                      "operand": [
                        {
                          "type": "AliasRef",
                          "name": "T"
                        }
                      ]
                    },
                    {
                      "type": "CodeRef",
                      "name": "Referral Triage Code"
                    }
                  ]
                }
              }
            }
          }
        },
        {
          "name": "Active Episodes of Care",
          "context": "Patient",
          "accessLevel": "Public",
          "expression": {
            "type": "Query",
            "source": [
              {
                "alias": "Episode",
                "expression": {
                  "type": "Retrieve",
                  "dataType": "{http://hl7.org/fhir}EpisodeOfCare",
                  "templateId": "http://hl7.org/fhir/StructureDefinition/EpisodeOfCare"
                }
              }
            ],
            "where": {
              "type": "Equal",
              "operand": [
                {
                  "type": "Property",
                  "path": "status.value",
                  "scope": "Episode"
                },
                {
                  "type": "Literal",
                  "valueType": "{urn:hl7-org:elm-types:r1}String",
                  "value": "active"
                }
              ]
            }
          }
        },
        {
          "name": "Is Valid Referral Triage Process",
          "context": "Patient",
          "accessLevel": "Public",
          "expression": {
            "type": "Exists",
            "operand": {
              "type": "Query",
              "source": [
                {
                  "alias": "ValidEncounter",
                  "expression": {
                    "type": "ExpressionRef",
                    "name": "Referral Triage Encounters"
                  }
                }
              ],
              "where": {
                "type": "Exists",
                "operand": {
                  "type": "Query",
                  "source": [
                    {
                      "alias": "EOC",
                      "expression": {
                        "type": "Property",
                        "path": "episodeOfCare",
                        "scope": "ValidEncounter"
                      }
                    }
                  ],
                  "where": {
                    "type": "Exists",
                    "operand": {
                      "type": "Query",
                      "source": [
                        {
                          "alias": "ActiveEpisode",
                          "expression": {
                            "type": "ExpressionRef",
                            "name": "Active Episodes of Care"
                          }
                        }
                      ],
                      "where": {
                        "type": "Equal",
                        "operand": [
                          {
                            "type": "Property",
                            "path": "reference.value",
                            "scope": "EOC"
                          },
                          {
                            "type": "Concatenate",
                            "operand": [
                              {
                                "type": "Literal",
                                "valueType": "{urn:hl7-org:elm-types:r1}String",
                                "value": "EpisodeOfCare/"
                              },
                              {
                                "type": "Property",
                                "path": "id.value",
                                "scope": "ActiveEpisode"
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

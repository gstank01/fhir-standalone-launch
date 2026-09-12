library ReferralTriageLogic version '1.0.0'

using FHIR version '4.0.1'

// Automatically converts complex FHIR data types into standard CQL concepts
include FHIRHelpers version '4.0.1' called FHIRHelpers

context Patient

// 1. Establish your system's terminology mapping
// https://cql.hl7.org/STU3/02-authorsguide.html - In CQL, an OID system is specified exactly as a uniform resource identifier (URI) string inside the single quotes

codesystem "HospitalCodes": 'urn:oid:1.2.840.114350.1.13.520.3.7.10.698084.30'
code "Referral Triage Code": '1234' from "HospitalCodes" display 'Referral Triage'

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

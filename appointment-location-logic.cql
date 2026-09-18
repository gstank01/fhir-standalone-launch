library AppointmentLocationLogic version '1.0.0'

using FHIR version '4.0.1'

// Automatically converts complex FHIR data types into standard CQL concepts
include FHIRHelpers version '4.0.1' called FHIRHelpers

context Patient

// 1. The organization code below is NOT present in the FHIR bundle as a
// human-readable name — Location.managingOrganization comes back as a bare
// Identifier (no included Organization resource), so all we ever see is
// the code 'RPY 01'. The display name "Royal Marsden Chelsea" is a
// separate, manually-maintained mapping (kept in api/evaluateCql.js next to
// this rule), exactly the same way "Referral Triage" is a manual mapping
// for code 2611 in ReferralTriageLogic — neither display string is ever
// read off the bundle itself.
// NOTE: identifier.value.value (not identifier.value) — every FHIR
// primitive is wrapped as {value: ...} by the engine and CQL unwraps it
// with a trailing .value, same as episodeOfCare's .reference.value below;
// Identifier's own FHIR field happens to be named "value" too, so the path
// needs BOTH: one .value for the Identifier's "value" field, one more to
// unwrap that field's primitive wrapper.
define "Royal Marsden Chelsea Locations":
  [Location] L
    where L.managingOrganization.identifier.value.value = 'RPY 01'

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

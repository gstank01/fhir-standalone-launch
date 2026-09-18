library AppointmentLocationLogic version '1.0.0'

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

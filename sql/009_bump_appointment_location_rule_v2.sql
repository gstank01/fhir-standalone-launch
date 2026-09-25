-- Bumps AppointmentLocationLogic from v1.0.0 to v2.0.0.
--
-- IMPORTANT: the matching logic itself — the CQL `define` statements /
-- compiled ELM — is UNCHANGED from v1.0.0. sql/006_seed_appointment_location_rule.sql
-- is left exactly as-is in this repo (and in git history) as the permanent
-- record of v1. This migration only bumps the version/description on the
-- existing row; it does not touch cql_text or elm_json.
--
-- What v2 actually adds lives entirely in api/evaluateCql.js: a successful
-- evaluation now also returns a FHIR Bundle (`matchedBundle`) containing the
-- Patient plus each matching Appointment and its Location, assembled in JS
-- after the CQL engine's boolean result — nothing about which appointments
-- qualify has changed.
--
-- Run this once against the Neon database after sql/006. Safe to re-run.

UPDATE cql_rules
SET version = '2.0.0',
    description = 'v2: identical matching criteria to v1.0.0. Evaluation now also returns a FHIR Bundle (matchedBundle) containing the Patient + each matching Appointment + its Location.',
    updated_at = now()
WHERE name = 'AppointmentLocationLogic';

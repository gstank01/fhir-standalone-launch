-- Adds an appointment_status column to referral_queue — the FHIR
-- Appointment.status (e.g. "booked", "arrived", "fulfilled", "cancelled")
-- for the specific appointment a row matched, populated only for
-- AppointmentLocationLogic rows (NULL for ReferralTriageLogic and any
-- other rule, same as location_name/episode_name already are).
--
-- Run this once against the Neon database after sql/007. Safe to re-run.

ALTER TABLE referral_queue ADD COLUMN IF NOT EXISTS appointment_status TEXT;

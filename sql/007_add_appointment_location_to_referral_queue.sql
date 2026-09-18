-- Lets AppointmentLocationLogic queue one row PER MATCHING APPOINTMENT
-- (with that appointment's location attached) instead of a single row per
-- patient. ReferralTriageLogic keeps its existing one-row-per-patient
-- behavior — its rows just carry appointment_id = '' (the "no specific
-- appointment" sentinel), so they still upsert onto themselves the same
-- way they always have.
--
-- Run this once against the Neon database (Neon SQL editor, psql, etc.)
-- after sql/001_create_referral_queue.sql. Safe to re-run.

-- 1. Add the new columns.
ALTER TABLE referral_queue ADD COLUMN IF NOT EXISTS appointment_id TEXT NOT NULL DEFAULT '';
ALTER TABLE referral_queue ADD COLUMN IF NOT EXISTS location_name TEXT;

-- 2. Drop the old single-column UNIQUE(patient_id) constraint — it would
-- otherwise block a second row for the same patient (a different matching
-- appointment). Looked up dynamically instead of hardcoding its default
-- generated name, in case it was created or renamed differently.
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'referral_queue'::regclass
    AND con.contype = 'u'
    AND array_length(con.conkey, 1) = 1
    AND con.conkey[1] = (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'referral_queue'::regclass AND attname = 'patient_id'
    );

  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE referral_queue DROP CONSTRAINT %I', cname);
  END IF;
END $$;

-- 3. Add the new composite uniqueness: one row per (patient, appointment) —
-- '' for appointment_id still collapses to at most one row per patient for
-- rules (like ReferralTriageLogic) that don't set it, matching the
-- pre-existing upsert-by-patient behavior.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'referral_queue_patient_appt_key'
  ) THEN
    ALTER TABLE referral_queue
      ADD CONSTRAINT referral_queue_patient_appt_key UNIQUE (patient_id, appointment_id);
  END IF;
END $$;

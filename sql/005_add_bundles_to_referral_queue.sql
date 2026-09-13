-- Stores the raw Patient/Encounter bundles alongside each queued patient, so
-- the queue view can show exactly what data caused the match, not just the
-- name/MRN/status summary. Populated by api/evaluateCql.js's
-- addToReferralQueue(), read by api/queue.js.
ALTER TABLE referral_queue ADD COLUMN IF NOT EXISTS patient_bundle_json JSONB;
ALTER TABLE referral_queue ADD COLUMN IF NOT EXISTS encounter_bundle_json JSONB;

-- Track which cql_rules row actually matched when a patient was queued, now
-- that api/evaluateCql.js can run more than one rule.
ALTER TABLE referral_queue ADD COLUMN IF NOT EXISTS rule_name TEXT;

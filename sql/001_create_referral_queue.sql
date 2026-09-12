-- Referral queue: patients that the CQL engine has evaluated as matching the
-- "Is Valid Referral Triage Process" rule in triage-logic.cql and that should
-- be actioned. Populated by api/evaluateCql.js, read by api/queue.js.
--
-- Run this once against the Neon database (Neon SQL editor, psql, etc.) before
-- deploying the queue feature. Assumes worklist_patients already exists
-- (see the table read by api/worklist.js).

CREATE TABLE IF NOT EXISTS referral_queue (
    id SERIAL PRIMARY KEY,
    patient_id TEXT NOT NULL UNIQUE, -- FHIR logical Patient id
    identifier TEXT,                 -- MRN / lookup identifier used to find the patient
    name TEXT,
    dob TEXT,
    status TEXT NOT NULL DEFAULT 'Pending Action',
    details TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_queue_created_at_idx ON referral_queue (created_at DESC);

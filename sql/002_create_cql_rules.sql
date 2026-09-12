-- CQL rules library: instead of a single compiled ELM file baked into the
-- deployment (api/logic.json), each rule now lives as a row here. Adding a
-- new rule (or updating an existing one) is a database write via
-- POST /api/rules — no code change or redeploy required — and any workflow
-- (the CQL-app worklist today, others later) can invoke a rule by name.
--
-- Run this once against the Neon database (Neon SQL editor, psql, etc.)
-- before deploying the DB-backed rules feature.
--
-- Why elm_json and not just the raw .cql text: cql-execution (the engine
-- api/evaluateCql.js runs) executes compiled ELM, not CQL source, and this
-- environment has no CQL-to-ELM translator available to compile CQL at
-- request time. Author the CQL, compile it to ELM with the reference
-- translator (e.g. the `cqframework/cql-translation-service` Docker image,
-- or https://github.com/cqframework/clinical_quality_language), and store
-- BOTH: cql_text so the rule stays human-readable/auditable, and elm_json
-- (the exact object shape read from a compiled ELM file, i.e. it has a
-- top-level "library" key) which is what actually gets executed.

CREATE TABLE IF NOT EXISTS cql_rules (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,             -- matches the ELM library's identifier.id, e.g. 'ReferralTriageLogic'
    version TEXT NOT NULL DEFAULT '1.0.0',
    description TEXT,
    result_expression TEXT NOT NULL,       -- the boolean `define` callers should read, e.g. 'Is Valid Referral Triage Process'
    cql_text TEXT,                         -- human-readable CQL source, for reference/audit (not executed)
    elm_json JSONB NOT NULL,               -- compiled ELM, e.g. the exact contents of a logic.json file — this IS executed
    active BOOLEAN NOT NULL DEFAULT true,
    workflows TEXT[] NOT NULL DEFAULT ARRAY['cql-app'], -- which app workflow(s) may invoke this rule
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cql_rules_active_idx ON cql_rules (active);

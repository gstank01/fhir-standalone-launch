// One-off script to seed the cql_rules table (see sql/002_create_cql_rules.sql)
// with the rule that used to live only in api/logic.json. Run this once,
// after applying the migrations, to move the existing "ReferralTriageLogic"
// rule into the database.
//
// Usage:
//   DATABASE_URL="postgres://..." node scripts/seed-cql-rules.js
//
// Safe to re-run: it upserts by rule name, so re-running after editing
// api/logic.json or triage-logic.cql just refreshes the stored row.

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Example:\n  DATABASE_URL="postgres://..." node scripts/seed-cql-rules.js');
    process.exit(1);
  }

  const elmJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'api', 'logic.json'), 'utf8'));
  const cqlText = fs.readFileSync(path.join(__dirname, '..', 'triage-logic.cql'), 'utf8');

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    INSERT INTO cql_rules (name, version, description, result_expression, cql_text, elm_json, active, workflows)
    VALUES (
      'ReferralTriageLogic',
      '1.0.0',
      'Flags a patient for the referral triage queue when they have a Referral Triage encounter linked to an active EpisodeOfCare.',
      'Is Valid Referral Triage Process',
      ${cqlText},
      ${JSON.stringify(elmJson)}::jsonb,
      true,
      ARRAY['cql-app']
    )
    ON CONFLICT (name) DO UPDATE SET
      version = EXCLUDED.version,
      description = EXCLUDED.description,
      result_expression = EXCLUDED.result_expression,
      cql_text = EXCLUDED.cql_text,
      elm_json = EXCLUDED.elm_json,
      active = EXCLUDED.active,
      workflows = EXCLUDED.workflows,
      updated_at = now()
  `;

  console.log('Seeded/updated "ReferralTriageLogic" in cql_rules.');
}

main().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

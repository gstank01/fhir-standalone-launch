// Manages the cql_rules table (sql/002_create_cql_rules.sql): the library of
// CQL rules that api/evaluateCql.js can invoke by name. This is what makes
// adding a new rule a database write instead of a code change/redeploy.
//
//   GET  /api/rules                      -> list rules (optionally filtered)
//   GET  /api/rules?workflow=cql-app     -> only rules tagged for that workflow
//   GET  /api/rules?active=true          -> only active rules (default: all)
//   POST /api/rules                      -> create or update (upsert by name)
//
// POST body:
//   {
//     "name": "ReferralTriageLogic",              // required, matches the ELM library id
//     "version": "1.0.0",                          // optional, defaults '1.0.0'
//     "description": "...",                        // optional
//     "resultExpression": "Is Valid ...",           // required — the boolean `define` to read
//     "cqlText": "library ... define ...",          // optional, human-readable source for reference
//     "elmJson": { "library": { ... } },            // required — compiled ELM (see api/logic.json for the shape)
//     "active": true,                               // optional, defaults true
//     "workflows": ["cql-app"]                      // optional, defaults ["cql-app"]
//   }
//
// elmJson must be compiled ahead of time — this environment has no
// CQL-to-ELM translator available at request time. Use the CQL reference
// translator (e.g. the cqframework/cql-translation-service Docker image) to
// turn a .cql file into ELM JSON, then POST the result here.

import { neon } from '@neondatabase/serverless';

function rowToRule(row) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    resultExpression: row.result_expression,
    active: row.active,
    workflows: row.workflows,
    createdAt: row.created_at,
    updatedAt: row.updated_at
    // cql_text / elm_json intentionally omitted from the list response —
    // elm_json in particular can be large; fetch a single rule's full
    // content by name via evaluateCql's own DB read if ever needed.
  };
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const sql = neon(process.env.DATABASE_URL);

  if (req.method === 'GET') {
    try {
      const { workflow, active } = req.query || {};
      let rows;

      if (workflow && active === 'true') {
        rows = await sql`SELECT * FROM cql_rules WHERE active = true AND ${workflow} = ANY(workflows) ORDER BY name ASC`;
      } else if (workflow) {
        rows = await sql`SELECT * FROM cql_rules WHERE ${workflow} = ANY(workflows) ORDER BY name ASC`;
      } else if (active === 'true') {
        rows = await sql`SELECT * FROM cql_rules WHERE active = true ORDER BY name ASC`;
      } else {
        rows = await sql`SELECT * FROM cql_rules ORDER BY name ASC`;
      }

      return res.status(200).json({ success: true, rules: rows.map(rowToRule) });
    } catch (error) {
      console.error('Neon DB Error while listing cql_rules:', error);
      return res.status(500).json({ success: false, error: 'Internal Server Error while fetching CQL rules.' });
    }
  }

  if (req.method === 'POST') {
    try {
      const { name, version, description, resultExpression, cqlText, elmJson, active, workflows } = req.body || {};

      if (!name || typeof name !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing required field: name.' });
      }
      if (!resultExpression || typeof resultExpression !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing required field: resultExpression.' });
      }
      if (!elmJson || typeof elmJson !== 'object' || !elmJson.library || !elmJson.library.statements) {
        return res.status(400).json({
          success: false,
          error: 'Missing or invalid elmJson — expected a compiled ELM object with a top-level "library" key (see api/logic.json for the shape).'
        });
      }

      const rows = await sql`
        INSERT INTO cql_rules (name, version, description, result_expression, cql_text, elm_json, active, workflows)
        VALUES (
          ${name},
          ${version || '1.0.0'},
          ${description || null},
          ${resultExpression},
          ${cqlText || null},
          ${JSON.stringify(elmJson)}::jsonb,
          ${active !== undefined ? active : true},
          ${workflows && workflows.length ? workflows : ['cql-app']}
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
        RETURNING *
      `;

      console.log(`[RULES] Upserted rule "${name}" (result_expression="${resultExpression}").`);
      return res.status(200).json({ success: true, rule: rowToRule(rows[0]) });
    } catch (error) {
      console.error('Neon DB Error while upserting cql_rules:', error);
      return res.status(500).json({ success: false, error: 'Internal Server Error while saving the CQL rule.' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}

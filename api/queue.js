// Reads and clears the referral queue: patients that api/evaluateCql.js has
// already determined match a CQL rule. GET lists the current queue contents
// for the CQL-app's queue view; DELETE removes entries (a single row by id,
// or the whole table for demo/reset purposes).

import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const sql = neon(process.env.DATABASE_URL);
            const items = await sql`
                SELECT id, patient_id, identifier, name, dob, status, details, rule_name, episode_name, appointment_id, location_name, appointment_status, created_at, updated_at
                FROM referral_queue
                ORDER BY created_at DESC
            `;

            return res.status(200).json({ success: true, items });
        } catch (error) {
            console.error("Neon DB Error:", error);
            // Include the real DB error (e.g. "column ... does not exist" when
            // a migration hasn't been run yet) — this is a dev tool, not a
            // public API, so the detail is worth more than hiding it.
            return res.status(500).json({ success: false, error: `Internal Server Error while fetching the output queue: ${error.message}` });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const sql = neon(process.env.DATABASE_URL);
            const { id, confirm } = req.body || {};

            if (id) {
                const deleted = await sql`DELETE FROM referral_queue WHERE id = ${id} RETURNING id`;
                return res.status(200).json({ success: true, deletedCount: deleted.length });
            }

            // A full clear needs an explicit confirm flag — this is meant for
            // resetting the queue between demos, not something a stray call
            // should be able to trigger.
            if (confirm !== true) {
                return res.status(400).json({
                    success: false,
                    error: 'Refusing to clear the whole queue without { confirm: true } in the request body.'
                });
            }

            const deleted = await sql`DELETE FROM referral_queue RETURNING id`;
            console.log(`[QUEUE] Cleared ${deleted.length} row(s) from referral_queue.`);
            return res.status(200).json({ success: true, deletedCount: deleted.length });
        } catch (error) {
            console.error("Neon DB Error while clearing referral_queue:", error);
            return res.status(500).json({ success: false, error: 'Internal Server Error while clearing the output queue.' });
        }
    }

    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}

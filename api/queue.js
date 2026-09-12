// Reads the referral queue: patients that api/evaluateCql.js has already
// determined match the CQL triage rule. This is a GET request to list the
// current queue contents for the CQL-app's queue view.

import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    try {
        const sql = neon(process.env.DATABASE_URL);
        const items = await sql`
            SELECT id, patient_id, identifier, name, dob, status, details, created_at, updated_at
            FROM referral_queue
            ORDER BY created_at DESC
        `;

        return res.status(200).json({ success: true, items });
    } catch (error) {
        console.error("Neon DB Error:", error);
        return res.status(500).json({ error: 'Internal Server Error while fetching referral queue.' });
    }
}

//connect to the DB to pull the patients for the worklist. This is a GET request to fetch the list of patients from the database.

import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }

    try {
        const sql = neon(process.env.DATABASE_URL);
        const patients = await sql`SELECT name, identifier, dob FROM worklist_patients ORDER BY name ASC`;
        
        return res.status(200).json({ success: true, patients });
    } catch (error) {
        console.error("Neon DB Error:", error);
        return res.status(500).json({ error: 'Internal Server Error while fetching worklist.' });
    }
}
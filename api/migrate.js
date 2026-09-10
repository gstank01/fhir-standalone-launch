// api/migrate.js
const { sql } = require('@vercel/postgres');

export default async function handler(req, res) {
  try {
    // 1. Create the database table for tracking patient triage tasks
    await sql`
      CREATE TABLE IF NOT EXISTS triage_queue (
        id SERIAL PRIMARY KEY,
        patient_id VARCHAR(100) NOT NULL,
        mrn VARCHAR(100),
        status VARCHAR(50) DEFAULT 'Pending Action',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        details TEXT,
        fhir_bundle JSONB
      );
    `;

    // 2. Generate optimized search indices
    await sql`CREATE INDEX IF NOT EXISTS idx_triage_patient ON triage_queue(patient_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_triage_status ON triage_queue(status);`;

    return res.status(200).json({ 
      success: true, 
      message: "Neon Postgres database tables and indices initialized successfully." 
    });
  } catch (error) {
    console.error("Migration Error:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

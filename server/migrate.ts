import 'dotenv/config';
import { sql } from './db';

console.log('Running migrations…');

await sql`
  CREATE TABLE IF NOT EXISTS monthly_performance (
    id            SERIAL PRIMARY KEY,
    employee_id   VARCHAR(50) NOT NULL,
    reviewer_id   VARCHAR(50),
    reviewer_name VARCHAR(100),
    month         INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year          INTEGER NOT NULL,
    productivity     INTEGER NOT NULL DEFAULT 0,
    quality          INTEGER NOT NULL DEFAULT 0,
    teamwork         INTEGER NOT NULL DEFAULT 0,
    attendance_score INTEGER NOT NULL DEFAULT 0,
    initiative       INTEGER NOT NULL DEFAULT 0,
    overall_score    INTEGER NOT NULL DEFAULT 0,
    comments         TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, month, year)
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS performance_notes (
    id              SERIAL PRIMARY KEY,
    employee_id     VARCHAR(50) NOT NULL,
    note_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    note_text       TEXT NOT NULL,
    note_type       VARCHAR(20) DEFAULT 'neutral',
    created_by_id   VARCHAR(50),
    created_by_name VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )
`;

console.log('✓ monthly_performance table ready');
console.log('✓ performance_notes table ready');
console.log('Migration complete.');

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

// Add client_satisfaction column if it doesn't exist
await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS client_satisfaction INTEGER NOT NULL DEFAULT 0`;

await sql`
  CREATE TABLE IF NOT EXISTS appraisal_goals (
    id          SERIAL PRIMARY KEY,
    employee_id VARCHAR(50) NOT NULL,
    year        INTEGER NOT NULL,
    goals       JSONB NOT NULL DEFAULT '[]',
    submitted   BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(employee_id, year)
  )
`;

// Add month column to appraisal_goals (enables multiple appraisals per year)
await sql`ALTER TABLE appraisal_goals ADD COLUMN IF NOT EXISTS month INTEGER`;
await sql`UPDATE appraisal_goals SET month = EXTRACT(MONTH FROM created_at)::INTEGER WHERE month IS NULL`;
// Migrate unique constraint from (employee_id, year) → (employee_id, month, year)
await sql`ALTER TABLE appraisal_goals DROP CONSTRAINT IF EXISTS appraisal_goals_employee_id_year_key`;
try {
  await sql`ALTER TABLE appraisal_goals ADD CONSTRAINT appraisal_goals_emp_month_year_key UNIQUE(employee_id, month, year)`;
} catch (e: any) {
  if (!String(e.message).includes('already exists')) throw e;
}
// Make month NOT NULL now that it's backfilled
await sql`ALTER TABLE appraisal_goals ALTER COLUMN month SET NOT NULL`;
await sql`ALTER TABLE appraisal_goals ALTER COLUMN month SET DEFAULT 1`;

// Add next appraisal scheduling fields to employees
await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS next_appraisal_month INTEGER`;
await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS next_appraisal_year INTEGER`;

// Notifications table
await sql`
  CREATE TABLE IF NOT EXISTS notifications (
    id         SERIAL PRIMARY KEY,
    user_id    VARCHAR(50) NOT NULL,
    type       VARCHAR(50) NOT NULL,
    title      VARCHAR(200) NOT NULL,
    body       TEXT,
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`;
await sql`CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id)`;
await sql`CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(user_id, is_read)`;
console.log('✓ notifications table ready');

console.log('✓ monthly_performance table ready');
console.log('✓ performance_notes table ready');
console.log('✓ appraisal_goals table ready (month column + new unique key)');
console.log('✓ employees table: next_appraisal_month / next_appraisal_year columns ready');
console.log('Migration complete.');

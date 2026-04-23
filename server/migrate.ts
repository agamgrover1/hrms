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

// Reporting manager (FK to employees.id — can be any employee)
await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS reporting_manager_id VARCHAR(50)`;

// Custom probation end date (overrides join_date + 90 days default when set)
await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date DATE`;

// 2-step leave approval: manager approval fields
await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_status VARCHAR(20) DEFAULT 'pending'`;
await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_id VARCHAR(50)`;
await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_approved_at TIMESTAMPTZ`;

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

// New leave policy columns on leave_balances
await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS full_day INTEGER NOT NULL DEFAULT 0`;
await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS short_leave INTEGER NOT NULL DEFAULT 0`;
await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_credited_month INTEGER`;
await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_credited_year INTEGER`;
await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS probation_short_used INTEGER NOT NULL DEFAULT 0`;

// Seed initial credit for existing non-probation employees (give this month's allocation)
const now = new Date();
const cm = now.getMonth() + 1;
const cy = now.getFullYear();
await sql`
  UPDATE leave_balances lb
  SET full_day = 1, short_leave = 2,
      last_credited_month = ${cm}, last_credited_year = ${cy}
  FROM employees e
  WHERE lb.employee_id = e.id
    AND (lb.last_credited_month IS NULL)
    AND (e.join_date IS NULL OR e.join_date < NOW() - INTERVAL '90 days')
`;
// Seed probation employees — no full day, 2 short leave allowance for whole probation
await sql`
  UPDATE leave_balances lb
  SET full_day = 0, short_leave = 2,
      last_credited_month = ${cm}, last_credited_year = ${cy}
  FROM employees e
  WHERE lb.employee_id = e.id
    AND (lb.last_credited_month IS NULL)
    AND e.join_date >= NOW() - INTERVAL '90 days'
`;
console.log('✓ leave_balances: new policy columns ready');

console.log('✓ monthly_performance table ready');
console.log('✓ performance_notes table ready');
console.log('✓ appraisal_goals table ready (month column + new unique key)');
console.log('✓ employees table: next_appraisal_month / next_appraisal_year columns ready');
console.log('Migration complete.');

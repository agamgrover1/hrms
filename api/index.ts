import express from 'express';
import cors from 'cors';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

// Lazy Neon client — always typed as Promise<any[]> to satisfy TypeScript 6 strict mode
let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return (_sql = neon(url.replace(/[?&]channel_binding=[^&]*/g, '').replace(/[?&]$/, '')));
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sql = ((...a: any[]) => (getSql() as any)(...a)) as (...args: any[]) => Promise<any[]>;

const app = express();
// Build the set of allowed origins — hardcoded + any extras from CORS_ORIGIN env var
const ALLOWED_ORIGINS = new Set([
  'https://hr.digitalleapmarketing.com',
  'https://hrms.digitalleapmarketing.com',
  ...(process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim().replace(/\/$/, ''))
    : []),
]);

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / server-to-server
  const o = origin.replace(/\/$/, ''); // strip trailing slash
  return (
    o.endsWith('.vercel.app') ||
    o.startsWith('http://localhost') ||
    o.startsWith('http://127.0.0.1') ||
    o.includes('digitalleapmarketing.com') ||
    o.startsWith('chrome-extension://') || // Digital Leap HRMS Chrome extension
    ALLOWED_ORIGINS.has(o)
  );
}

app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());

// ── Notification helpers ──────────────────────────────────────────────────
async function notifyUser(userId: string, type: string, title: string, body?: string) {
  try {
    await sql`INSERT INTO notifications (user_id, type, title, body) VALUES (${userId}, ${type}, ${title}, ${body ?? null})`;
  } catch { /* non-fatal */ }
}

async function notifyAdminsAndHR(type: string, title: string, body?: string) {
  try {
    const users = await sql`SELECT id FROM app_users WHERE role IN ('admin', 'hr_manager') AND active = TRUE`;
    await Promise.all((users as any[]).map((u: any) => notifyUser(u.id, type, title, body)));
  } catch { /* non-fatal */ }
}

async function notifyCoordinators(type: string, title: string, body?: string) {
  try {
    const users = await sql`SELECT id FROM app_users WHERE role IN ('admin', 'hr_manager', 'project_coordinator') AND active = TRUE`;
    await Promise.all((users as any[]).map((u: any) => notifyUser(u.id, type, title, body)));
  } catch { /* non-fatal */ }
}

// Capture every change to an hour_log so partial / unilateral admin edits are visible
async function recordHourLogAudit(p: {
  hour_log_id: string;
  action: 'created' | 'edited' | 'approved' | 'rejected' | 'admin_edit' | 'resubmitted' | 'deleted';
  actor_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  before?: { hours_logged?: number | null; status?: string | null; work_description?: string | null } | null;
  after?: { hours_logged?: number | null; status?: string | null; work_description?: string | null } | null;
  reason?: string | null;
}) {
  try {
    await sql`
      INSERT INTO hour_log_audit (
        hour_log_id, action, actor_id, actor_name, actor_role,
        before_hours, after_hours, before_status, after_status,
        before_description, after_description, reason
      ) VALUES (
        ${p.hour_log_id}, ${p.action},
        ${p.actor_id ?? null}, ${p.actor_name ?? null}, ${p.actor_role ?? null},
        ${p.before?.hours_logged ?? null}, ${p.after?.hours_logged ?? null},
        ${p.before?.status ?? null}, ${p.after?.status ?? null},
        ${p.before?.work_description ?? null}, ${p.after?.work_description ?? null},
        ${p.reason ?? null}
      )`;
  } catch { /* non-fatal */ }
}

async function notifyEmployeeUser(employeeDbId: string, type: string, title: string, body?: string) {
  try {
    const users = await sql`SELECT u.id FROM app_users u JOIN employees e ON e.employee_id = u.employee_id_ref WHERE e.id = ${employeeDbId}`;
    await Promise.all((users as any[]).map((u: any) => notifyUser(u.id, type, title, body)));
  } catch { /* non-fatal */ }
}

async function notifyManagerOfEmployee(employeeDbId: string, type: string, title: string, body?: string) {
  try {
    const empRows = await sql`SELECT reporting_manager_id FROM employees WHERE id = ${employeeDbId}`;
    const managerId = (empRows as any[])[0]?.reporting_manager_id;
    if (managerId) {
      await notifyEmployeeUser(managerId, type, title, body);
    } else {
      await notifyAdminsAndHR(type, title, body); // fallback to HR if no manager
    }
  } catch { /* non-fatal */ }
}

// ── Startup migrations (idempotent — safe to run on every cold start) ────
let _migrated = false;
async function runStartupMigrations() {
  if (_migrated) return;
  _migrated = true;

  // ── Core tables (CREATE IF NOT EXISTS — works on a fresh database) ──────
  await sql`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
      phone TEXT, department TEXT, designation TEXT, employee_id TEXT UNIQUE,
      join_date DATE, location TEXT, manager TEXT, reporting_manager_id TEXT,
      status TEXT DEFAULT 'active', avatar TEXT, salary NUMERIC DEFAULT 0,
      ctc NUMERIC DEFAULT 0, biometric_id TEXT, shift TEXT DEFAULT 'day',
      next_appraisal_month INTEGER, next_appraisal_year INTEGER,
      probation_end_date DATE, date_of_birth DATE, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY, employee_id_ref TEXT, name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'employee',
      department TEXT, designation TEXT, avatar TEXT,
      active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS attendance_records (
      id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL, date DATE NOT NULL,
      status TEXT NOT NULL, check_in TEXT, check_out TEXT,
      total_hours NUMERIC DEFAULT 0, source TEXT DEFAULT 'manual',
      biometric_sync_id TEXT,
      UNIQUE(employee_id, date)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS leave_balances (
      employee_id TEXT PRIMARY KEY, full_day INTEGER NOT NULL DEFAULT 0,
      short_leave INTEGER NOT NULL DEFAULT 2, casual INTEGER DEFAULT 10,
      sick INTEGER DEFAULT 7, earned INTEGER DEFAULT 15,
      last_credited_month INTEGER, last_credited_year INTEGER,
      probation_short_used INTEGER NOT NULL DEFAULT 0
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS leave_requests (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT,
      type TEXT NOT NULL, from_date DATE NOT NULL, to_date DATE NOT NULL,
      days INTEGER DEFAULT 1, reason TEXT, status TEXT DEFAULT 'pending',
      manager_status TEXT DEFAULT 'pending', manager_id TEXT, manager_name TEXT,
      manager_rejection_reason TEXT, manager_approved_at TIMESTAMPTZ,
      hr_actioner_name TEXT, hr_actioned_at TIMESTAMPTZ, rejection_reason TEXT,
      cancelled_by TEXT, cancelled_at TIMESTAMPTZ, cancellation_reason TEXT,
      applied_on TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT, is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS payroll_records (
      id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL, month TEXT, year INTEGER,
      basic_salary NUMERIC DEFAULT 0, hra NUMERIC DEFAULT 0,
      allowances NUMERIC DEFAULT 0, gross_salary NUMERIC DEFAULT 0,
      pf NUMERIC DEFAULT 0, professional_tax NUMERIC DEFAULT 0,
      tds NUMERIC DEFAULT 0, total_deductions NUMERIC DEFAULT 0,
      net_pay NUMERIC DEFAULT 0
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS monthly_performance (
      id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL, reviewer_id TEXT,
      reviewer_name TEXT, month INTEGER NOT NULL, year INTEGER NOT NULL,
      productivity NUMERIC DEFAULT 0, quality NUMERIC DEFAULT 0,
      teamwork NUMERIC DEFAULT 0, attendance_score NUMERIC DEFAULT 0,
      initiative NUMERIC DEFAULT 0, client_satisfaction NUMERIC DEFAULT 0,
      ai_usage NUMERIC DEFAULT 0, overall_score NUMERIC DEFAULT 0,
      comments TEXT, parameter_notes JSONB, is_locked BOOLEAN DEFAULT FALSE,
      locked_by TEXT, locked_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, month, year)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS performance_goals (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT, target_date DATE, progress INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress', created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS performance_notes (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, note_date DATE,
      note_text TEXT NOT NULL, note_type TEXT DEFAULT 'general',
      created_by_id TEXT, created_by_name TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS appraisal_goals (
      id SERIAL PRIMARY KEY, employee_id TEXT NOT NULL,
      year INTEGER NOT NULL, month INTEGER NOT NULL,
      goals JSONB DEFAULT '[]', submitted BOOLEAN DEFAULT FALSE,
      submitted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, month, year)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS wfh_requests (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT,
      date DATE NOT NULL, type TEXT DEFAULT 'full_day', reason TEXT,
      status TEXT DEFAULT 'pending', manager_status TEXT DEFAULT 'pending',
      manager_id TEXT, manager_name TEXT, manager_approved_at TIMESTAMPTZ,
      manager_rejection_reason TEXT, hr_actioner_name TEXT, hr_actioned_at TIMESTAMPTZ,
      rejection_reason TEXT, cancelled_by TEXT, cancelled_at TIMESTAMPTZ,
      cancellation_reason TEXT, applied_on TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS employee_warnings (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT,
      reason TEXT NOT NULL, severity TEXT DEFAULT 'warning',
      issued_by TEXT, issued_by_role TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS employee_pips (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT,
      start_date DATE NOT NULL, end_date DATE NOT NULL, reason TEXT,
      goals TEXT, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS upsell_requests (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT,
      client_name TEXT NOT NULL, service_description TEXT NOT NULL,
      deal_value NUMERIC, requested_amount NUMERIC, notes TEXT,
      status TEXT DEFAULT 'pending', reviewed_by TEXT, reviewed_at TIMESTAMPTZ,
      rejection_reason TEXT, approved_amount NUMERIC, payment_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS expense_requests (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT,
      category TEXT NOT NULL, description TEXT NOT NULL, amount NUMERIC NOT NULL,
      receipt_note TEXT, expense_date DATE, status TEXT DEFAULT 'pending',
      reviewed_by TEXT, reviewed_at TIMESTAMPTZ, rejection_reason TEXT,
      approved_amount NUMERIC, payment_note TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  // ── IT vendor + assets + repair tickets ──────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, contact_person TEXT, phone TEXT,
      email TEXT, gst_no TEXT, address TEXT, notes TEXT,
      active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, asset_tag TEXT UNIQUE NOT NULL, model TEXT,
      serial_no TEXT, purchase_date DATE,
      assigned_to_id TEXT, assigned_to_name TEXT,
      status TEXT DEFAULT 'active',  -- active | in_repair | retired
      notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS repair_tickets (
      id TEXT PRIMARY KEY,
      asset_id TEXT, laptop_info TEXT,
      employee_id TEXT, employee_name TEXT,
      vendor_id TEXT, issue TEXT NOT NULL,
      status TEXT DEFAULT 'reported',
        -- reported | picked_up | returned | awaiting_approval | paid | cancelled
      quoted_cost NUMERIC, final_cost NUMERIC,
      requires_approval BOOLEAN DEFAULT FALSE,
      approved_by TEXT, approved_at TIMESTAMPTZ,
      rejected_by TEXT, rejected_at TIMESTAMPTZ, rejection_reason TEXT,
      payment_status TEXT DEFAULT 'unpaid',   -- unpaid | paid
      payment_mode TEXT,                       -- UPI | Bank | Cash | Cheque
      payment_date DATE,
      notes TEXT,
      reported_at TIMESTAMPTZ DEFAULT NOW(),
      picked_up_at TIMESTAMPTZ, returned_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
      created_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS config_departments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS config_designations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS config_shifts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      start_time TEXT NOT NULL, end_time TEXT NOT NULL,
      late_after TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS optional_leave_dates (
      id TEXT PRIMARY KEY, date DATE NOT NULL, label TEXT NOT NULL,
      year INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(date, year)
    )`;
  // ── Project Hours module (replaces Google Sheet workflow) ────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      client_name TEXT,
      project_type TEXT,
      dashboard_url TEXT,
      project_reporting_id TEXT,
      project_reporting_name TEXT,
      project_lead_id TEXT,
      project_lead_name TEXT,
      status TEXT DEFAULT 'active',
      flag TEXT,
      flag_reason TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS project_assignments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      monthly_hours NUMERIC DEFAULT 0,
      w1_hours NUMERIC DEFAULT 0,
      w2_hours NUMERIC DEFAULT 0,
      w3_hours NUMERIC DEFAULT 0,
      w4_hours NUMERIC DEFAULT 0,
      w5_hours NUMERIC DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT,
      UNIQUE(project_id, employee_id, month, year)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS hour_log_days (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      hour_log_id TEXT,
      project_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      log_date DATE NOT NULL,
      week_num INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      hours NUMERIC NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(assignment_id, log_date)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hour_log_days_employee_month ON hour_log_days(employee_id, month, year)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_hour_log_days_week ON hour_log_days(assignment_id, week_num)`.catch(()=>{});

  await sql`
    CREATE TABLE IF NOT EXISTS hour_log_audit (
      id SERIAL PRIMARY KEY,
      hour_log_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      actor_role TEXT,
      before_hours NUMERIC,
      after_hours NUMERIC,
      before_status TEXT,
      after_status TEXT,
      before_description TEXT,
      after_description TEXT,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hour_log_audit_log_id ON hour_log_audit(hour_log_id)`.catch(()=>{});

  await sql`
    CREATE TABLE IF NOT EXISTS hour_logs (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      week_num INTEGER NOT NULL,
      hours_logged NUMERIC NOT NULL,
      work_description TEXT,
      status TEXT DEFAULT 'pending',
      rejection_reason TEXT,
      reviewed_by_id TEXT,
      reviewed_by_name TEXT,
      reviewed_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(assignment_id, week_num)
    )`;

  await sql`
    CREATE TABLE IF NOT EXISTS attendance_sync_log (
      id SERIAL PRIMARY KEY, sync_id TEXT UNIQUE, triggered TEXT,
      triggered_by TEXT, synced_at TIMESTAMPTZ DEFAULT NOW(), date_range TEXT,
      records_updated INTEGER DEFAULT 0, records_created INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success', error_msg TEXT,
      is_rolled_back BOOLEAN DEFAULT FALSE, rolled_back_at TIMESTAMPTZ
    )`;

  // ── Add missing columns to existing tables (idempotent) ─────────────────
  try {
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date DATE`;
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id TEXT`;
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`;
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`;
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS biometric_sync_id TEXT`;
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS extension_hours NUMERIC DEFAULT 0`;
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS activity_score NUMERIC`;
    await sql`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, date DATE NOT NULL,
        clock_in TEXT NOT NULL, clock_out TEXT, duration_minutes NUMERIC DEFAULT 0,
        source TEXT DEFAULT 'manual',
        active_minutes NUMERIC DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(()=>{});
    await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS active_minutes NUMERIC DEFAULT 0`.catch(()=>{});
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS full_day INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS short_leave INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_credited_month INTEGER`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_credited_year INTEGER`;
    // Breakdown columns so employees can see "X carried + Y credited this month"
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS prev_month_carry_full_day INTEGER DEFAULT 0`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS current_month_credit_full_day INTEGER DEFAULT 0`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS probation_short_used INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioner_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioned_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`;
    await sql`ALTER TABLE upsell_requests ALTER COLUMN requested_amount DROP NOT NULL`.catch(()=>{});
  } catch { /* columns may already exist — non-fatal */ }

  // ── Seed default config data ─────────────────────────────────────────────
  try {
    // Default shifts
    await sql`INSERT INTO config_shifts (id,name,start_time,end_time,late_after) VALUES ('day','Day Shift','09:00','18:00','10:00') ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO config_shifts (id,name,start_time,end_time,late_after) VALUES ('night','Night Shift','18:30','03:30','19:30') ON CONFLICT (id) DO NOTHING`;
    // Default departments (only if table is empty)
    const deptCount = await sql`SELECT COUNT(*) FROM config_departments`;
    if (String((deptCount[0] as any).count) === '0') {
      for (const d of ['Engineering','Product','Design','HR','Sales','Finance','Marketing','Operations','Legal','Customer Support']) {
        await sql`INSERT INTO config_departments (id,name) VALUES (${d.toLowerCase().replace(/\s+/g,'-')},${d}) ON CONFLICT (id) DO NOTHING`;
      }
    }
  } catch { /* non-fatal */ }

  // ── Create default admin user if none exists ─────────────────────────────
  try {
    const admins = await sql`SELECT id FROM app_users WHERE role = 'admin' LIMIT 1`;
    if (!(admins as any[]).length) {
      const hashedPw = await bcrypt.hash('Admin@1234', 10);
      await sql`
        INSERT INTO app_users (id, name, email, password, role, active)
        VALUES ('admin_default', 'Admin', 'admin@digitalleapmarketing.com', ${hashedPw}, 'admin', true)
        ON CONFLICT (id) DO NOTHING
      `;
    }
  } catch { /* non-fatal */ }
}

// ── Health / diagnostics ──────────────────────────────────────────────────
app.get('/api/health', async (_, res) => {
  const dbSet = !!process.env.DATABASE_URL;
  if (!dbSet) {
    return res.status(500).json({ status: 'error', error: 'DATABASE_URL environment variable is not set' });
  }
  try {
    await runStartupMigrations();
    res.json({ status: 'ok', db: 'connected' });
  } catch (e: any) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const rows = await sql`SELECT * FROM app_users WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = rows[0] as any;
    if (!user.active) return res.status(403).json({ error: 'Your account has been deactivated. Contact HR.' });
    const isHashed = typeof user.password === 'string' && user.password.startsWith('$2');
    const valid = isHashed ? await bcrypt.compare(password, user.password) : user.password === password;
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });
    // Auto-upgrade plain-text to bcrypt
    if (!isHashed) { const h = await bcrypt.hash(password, 10); await sql`UPDATE app_users SET password=${h} WHERE id=${user.id}`.catch(()=>{}); }
    const { password: _pw, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Employees ─────────────────────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
  try {
    const { reporting_manager_id } = req.query as any;
    if (reporting_manager_id) {
      res.json(await sql`SELECT * FROM employees WHERE reporting_manager_id = ${reporting_manager_id} ORDER BY name`);
    } else {
      res.json(await sql`SELECT * FROM employees ORDER BY name`);
    }
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/employees/:id', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM employees WHERE id = ${req.params.id}`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/employees', async (req, res) => {
  try {
    const { id, name, email, phone, department, designation, employee_id, join_date, location, manager, reporting_manager_id, status, avatar, salary, ctc, password, role, biometric_id, shift } = req.body;
    const rows = await sql`
      INSERT INTO employees (id, name, email, phone, department, designation, employee_id, join_date, location, manager, reporting_manager_id, status, avatar, salary, ctc, biometric_id, shift)
      VALUES (${id}, ${name}, ${email}, ${phone}, ${department}, ${designation}, ${employee_id}, ${join_date}, ${location}, ${manager ?? null}, ${reporting_manager_id ?? null}, ${status ?? 'active'}, ${avatar}, ${salary}, ${ctc}, ${biometric_id ?? null}, ${shift ?? 'day'})
      RETURNING *`;
    const emp = rows[0];
    // Initialise leave balance so the employee can apply leave immediately
    await sql`
      INSERT INTO leave_balances (employee_id, full_day, short_leave, casual, sick, earned,
        last_credited_month, last_credited_year, probation_short_used)
      VALUES (${(emp as any).id}, 0, 2, 10, 7, 15,
        ${new Date().getMonth() + 1}, ${new Date().getFullYear()}, 0)
      ON CONFLICT (employee_id) DO NOTHING
    `.catch(() => {});
    if (password) {
      const existing = await sql`SELECT id FROM app_users WHERE LOWER(email)=LOWER(${email})`;
      if (!existing.length) {
        await sql`
          INSERT INTO app_users (id, employee_id_ref, name, email, password, role, department, designation, avatar, active)
          VALUES (${`u_${id}`}, ${employee_id}, ${name}, ${email}, ${password}, ${role ?? 'employee'}, ${department}, ${designation}, ${avatar}, true)
        `.catch(() => {});
      }
    }
    res.status(201).json(emp);
  } catch (err: any) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'Employee ID or email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/employees/:id', async (req, res) => {
  try {
    const { name, email, phone, department, designation, join_date, location, manager, reporting_manager_id, status, salary, ctc, biometric_id, shift, next_appraisal_month, next_appraisal_year, date_of_birth } = req.body;
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`.catch(()=>{});
    const rows = await sql`
      UPDATE employees SET name=${name}, email=${email}, phone=${phone}, department=${department},
        designation=${designation}, join_date=${join_date || null},
        location=${location}, manager=${manager ?? null},
        reporting_manager_id=${reporting_manager_id ?? null},
        status=${status}, salary=${salary}, ctc=${ctc},
        biometric_id=${biometric_id ?? null}, shift=${shift ?? 'day'},
        next_appraisal_month=${next_appraisal_month ?? null}, next_appraisal_year=${next_appraisal_year ?? null},
        date_of_birth=${date_of_birth || null}
      WHERE id=${req.params.id} RETURNING *`;
    // Keep the linked app_users row in sync — name / department / designation are
    // denormalized there for the employee's own portal. Without this, HR can edit
    // the employee record but the user's MyPortal stays showing the old values.
    const updated = (rows as any[])[0];
    if (updated?.employee_id) {
      await sql`
        UPDATE app_users SET
          name=${name},
          department=${department},
          designation=${designation}
        WHERE employee_id_ref=${updated.employee_id}`.catch(()=>{});
    }
    res.json(updated);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/employees/:id/probation', async (req, res) => {
  try {
    await runStartupMigrations();
    const { probation_end_date } = req.body;

    const empRows = await sql`SELECT join_date, probation_end_date FROM employees WHERE id=${req.params.id}`;
    if (!empRows.length) return res.status(404).json({ error: 'Not found' });
    const emp = empRows[0] as any;
    const defaultEnd = emp.join_date
      ? (() => { const d = new Date(emp.join_date); d.setDate(d.getDate() + 90); return d; })()
      : null;
    const effectiveEnd = emp.probation_end_date ? new Date(emp.probation_end_date) : defaultEnd;
    const isConfirmed = effectiveEnd ? new Date() >= effectiveEnd : false;
    if (isConfirmed && probation_end_date && new Date(probation_end_date) > new Date()) {
      return res.status(400).json({ error: 'This employee has already completed probation and cannot be re-enrolled.' });
    }

    const rows = await sql`UPDATE employees SET probation_end_date=${probation_end_date ?? null} WHERE id=${req.params.id} RETURNING *`;
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    await sql`DELETE FROM employees WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

function normDateV(row: any): any {
  if (!row) return row;
  const fix = (v: any) => {
    if (!v) return v;
    const s: string = v instanceof Date ? v.toISOString() : String(v);
    if (!s.includes('T')) return s.slice(0, 10);
    return neonDateToStrV(s);
  };
  return { ...row, date: fix(row.date), from_date: fix(row.from_date), to_date: fix(row.to_date) };
}

// ── Attendance ────────────────────────────────────────────────────────────
app.get('/api/attendance', async (req, res) => {
  try {
    const { employee_id, month, year } = req.query as any;
    let rows;
    if (employee_id && month && year) {
      rows = await sql`SELECT * FROM attendance_records WHERE employee_id=${employee_id} AND EXTRACT(MONTH FROM date)=${Number(month)} AND EXTRACT(YEAR FROM date)=${Number(year)} ORDER BY date`;
    } else if (employee_id) {
      rows = await sql`SELECT * FROM attendance_records WHERE employee_id=${employee_id} ORDER BY date DESC`;
    } else if (month && year) {
      rows = await sql`SELECT * FROM attendance_records WHERE EXTRACT(MONTH FROM date)=${Number(month)} AND EXTRACT(YEAR FROM date)=${Number(year)} ORDER BY date DESC, employee_id`;
    } else {
      rows = await sql`SELECT * FROM attendance_records ORDER BY date DESC, employee_id`;
    }
    const todayV = new Date().toISOString().split('T')[0];
    res.json((rows as any[]).map(normDateV).filter((r: any) => !isWeekendV(r.date) && r.date <= todayV));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Helper: get IST date string (YYYY-MM-DD) and time string (HH:MM) from current UTC time
function istNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 330); // +5:30 IST offset
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}

// ── Session helpers ───────────────────────────────────────────────────────────
async function recalcAttendanceTotals(employeeId: string, date: string) {
  const sessions = await sql`
    SELECT clock_in, clock_out, duration_minutes, source
    FROM attendance_sessions
    WHERE employee_id=${employeeId} AND date::date=${date}::date
    ORDER BY clock_in ASC
  `;
  const rows = sessions as any[];
  const totalMin = rows.reduce((s, r) => s + Number(r.duration_minutes || 0), 0);
  const extMin   = rows.filter(r => r.source === 'wfh_extension').reduce((s, r) => s + Number(r.duration_minutes || 0), 0);
  const firstIn  = rows[0]?.clock_in ?? null;
  const lastOut  = [...rows].reverse().find(r => r.clock_out)?.clock_out ?? null;
  const totalHrs = Math.round(totalMin * 10 / 60) / 10;
  const extHrs   = Math.round(extMin   * 10 / 60) / 10;
  // Activity score = total active minutes across all sessions / total worked minutes × 100
  const totalActiveMin = rows.reduce((s, r) => s + Number(r.active_minutes || 0), 0);
  const activityScore  = totalMin > 0 ? Math.min(100, Math.round((totalActiveMin / totalMin) * 100)) : null;

  // Update total_hours first — this MUST succeed for the admin view to show correct hours.
  // Separate from extension_hours so that a missing column on extension_hours
  // does NOT silently swallow the total_hours update.
  await sql`
    UPDATE attendance_records
    SET total_hours=${totalHrs},
        check_in=COALESCE(${firstIn}, check_in),
        check_out=${lastOut}
    WHERE employee_id=${employeeId} AND date::date=${date}::date
  `;
  // extension_hours + activity_score — newer columns, update separately
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS extension_hours NUMERIC DEFAULT 0`.catch(()=>{});
  await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS activity_score NUMERIC`.catch(()=>{});
  await sql`
    UPDATE attendance_records
    SET extension_hours=${extHrs},
        activity_score=${activityScore}
    WHERE employee_id=${employeeId} AND date::date=${date}::date
  `.catch(() => {});
}

// GET /api/attendance/sessions — session-level breakdown for a specific day
app.get('/api/attendance/sessions', async (req, res) => {
  try {
    const { employee_id, date } = req.query as any;
    if (!employee_id || !date) return res.status(400).json({ error: 'employee_id and date are required' });
    const sessions = await sql`
      SELECT * FROM attendance_sessions
      WHERE employee_id=${employee_id} AND date::date=${date}::date
      ORDER BY clock_in ASC
    `.catch(() => []);
    res.json(sessions);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/attendance/activity — called every minute by the Chrome extension
// to report whether the employee was active during that minute.
// active=true increments active_minutes on the open session; active=false does nothing
// (idle minutes are inferred as: duration_minutes - active_minutes)
app.post('/api/attendance/activity', async (req, res) => {
  try {
    const { employee_id, active } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    if (!active) return res.json({ ok: true }); // idle minute — no update needed
    const { date: today } = istNow();
    // Find the open session for this employee today
    await sql`
      UPDATE attendance_sessions
      SET active_minutes = COALESCE(active_minutes, 0) + 1
      WHERE employee_id=${employee_id} AND date::date=${today}::date AND clock_out IS NULL
    `.catch(() => {});
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/attendance/today — used by the Chrome extension
app.get('/api/attendance/today', async (req, res) => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL,
        date DATE NOT NULL,
        clock_in TEXT NOT NULL,
        clock_out TEXT,
        duration_minutes NUMERIC DEFAULT 0,
        active_minutes NUMERIC DEFAULT 0,
        source TEXT DEFAULT 'manual',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(() => {});
    await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS active_minutes NUMERIC DEFAULT 0`.catch(() => {});
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS extension_hours NUMERIC DEFAULT 0`.catch(() => {});

    const { employee_id } = req.query as any;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const { date: today } = istNow();

    const empRows = await sql`SELECT * FROM employees WHERE id=${employee_id}`;
    if (!(empRows as any[]).length) return res.status(404).json({ error: 'Employee not found' });
    const emp = (empRows[0] as any);

    const shiftRows = await sql`SELECT * FROM config_shifts WHERE id=${emp.shift ?? 'day'}`.catch(() => []);
    const shift = (shiftRows as any[])[0] ?? { start_time: '09:00', end_time: '18:00', late_after: '10:00' };

    const attRows = await sql`SELECT * FROM attendance_records WHERE employee_id=${employee_id} AND date::date=${today}::date`;
    const att = (attRows as any[])[0] ?? null;

    // All sessions for today
    const sessions = await sql`
      SELECT * FROM attendance_sessions
      WHERE employee_id=${employee_id} AND date::date=${today}::date
      ORDER BY clock_in ASC
    `.catch(() => []);
    const sessionList = sessions as any[];
    const activeSession = sessionList.find(s => !s.clock_out) ?? null;

    const wfhRows = await sql`SELECT id FROM wfh_requests WHERE employee_id=${employee_id} AND date::date=${today}::date AND status='approved'`;
    const wfhToday = !!(wfhRows as any[]).length;

    const hasBiometric = att && att.source === 'biometric';
    const totalMin     = sessionList.reduce((s, r) => s + Number(r.duration_minutes || 0), 0);
    const extMin       = sessionList.filter(r => r.source === 'wfh_extension').reduce((s, r) => s + Number(r.duration_minutes || 0), 0);

    res.json({
      date: today,
      employee_name: emp.name,
      employee_code: emp.employee_id,
      shift: emp.shift ?? 'day',
      shift_start:   shift.start_time,
      shift_end:     shift.end_time,
      wfh_today:     wfhToday,
      has_biometric: !!hasBiometric,
      has_active_session: !!activeSession,
      active_session:     activeSession,
      sessions:      sessionList,
      total_minutes: totalMin,
      extension_minutes: extMin,
      active_minutes: sessionList.reduce((s, r) => s + Number(r.active_minutes || 0), 0),
      activity_score: att?.activity_score ?? null,
      total_hours:   att?.total_hours ?? 0,
      extension_hours: att?.extension_hours ?? 0,
      check_in:  att?.check_in  ?? null,
      check_out: att?.check_out ?? null,
      status:    att?.status    ?? null,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/attendance/clock-in', async (req, res) => {
  try {
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS extension_hours NUMERIC DEFAULT 0`.catch(() => {});
    await sql`
      CREATE TABLE IF NOT EXISTS attendance_sessions (
        id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, date DATE NOT NULL,
        clock_in TEXT NOT NULL, clock_out TEXT, duration_minutes NUMERIC DEFAULT 0,
        active_minutes NUMERIC DEFAULT 0,
        source TEXT DEFAULT 'manual', created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `.catch(() => {});
    await sql`ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS active_minutes NUMERIC DEFAULT 0`.catch(() => {});

    const { employee_id, source } = req.body;
    const { date: today, time } = istNow();
    if (isWeekendV(today)) return res.status(400).json({ error: 'Weekends are non-working days' });

    // Block if biometric already recorded
    const existingRec = await sql`SELECT source FROM attendance_records WHERE employee_id=${employee_id} AND date::date=${today}::date`;
    if ((existingRec as any[]).length && (existingRec[0] as any).source === 'biometric') {
      return res.status(409).json({ error: 'Biometric attendance already recorded for today.' });
    }

    // Block if there is already an open session
    const openSession = await sql`SELECT id FROM attendance_sessions WHERE employee_id=${employee_id} AND date::date=${today}::date AND clock_out IS NULL`;
    if ((openSession as any[]).length) {
      return res.status(409).json({ error: 'You are already clocked in. Clock out before starting a new session.' });
    }

    const empRow = await sql`SELECT shift FROM employees WHERE id=${employee_id}` as any[];
    if (!(empRow as any[]).length) return res.status(404).json({ error: 'Employee not found' });
    const empShift = empRow[0]?.shift ?? 'day';
    const lateAfter = await getShiftLateAfterV(empShift);
    const status      = isLateByTime(time, lateAfter) ? 'late' : 'present';
    const clockSource = source ?? 'manual';

    // Create session
    const sessionId = `sess_${Date.now()}`;
    const session = await sql`
      INSERT INTO attendance_sessions (id, employee_id, date, clock_in, source)
      VALUES (${sessionId}, ${employee_id}, ${today}, ${time}, ${clockSource})
      RETURNING *
    `;

    // Create attendance_records for today if not already present.
    // ON CONFLICT DO NOTHING avoids race condition from concurrent clock-in requests.
    await sql`
      INSERT INTO attendance_records (employee_id, date, check_in, status, total_hours, extension_hours, source)
      VALUES (${employee_id}, ${today}, ${time}, ${status}, 0, 0, ${clockSource})
      ON CONFLICT (employee_id, date) DO NOTHING
    `.catch(() => {});

    res.json({ session: (session as any[])[0], time, status });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/attendance/mark', async (req, res) => {
  try {
    const { employee_id, date, status, check_in, check_out } = req.body;
    if (!employee_id || !date || !status) {
      return res.status(400).json({ error: 'employee_id, date and status are required' });
    }
    const totalHours = check_in && check_out
      ? Math.round(
          ((new Date(`1970-01-01T${check_out}`) as any) - (new Date(`1970-01-01T${check_in}`) as any)) / 360000
        ) / 10
      : 0;
    const rows = await sql`
      INSERT INTO attendance_records (employee_id, date, check_in, check_out, status, total_hours)
      VALUES (${employee_id}, ${date}, ${check_in ?? null}, ${check_out ?? null}, ${status}, ${totalHours})
      ON CONFLICT (employee_id, date) DO UPDATE SET
        check_in = ${check_in ?? null},
        check_out = ${check_out ?? null},
        status = ${status},
        total_hours = ${totalHours}
      RETURNING *`;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/attendance/clock-out', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const { date: today, time } = istNow();

    // Find the open session
    const openRows = await sql`
      SELECT * FROM attendance_sessions
      WHERE employee_id=${employee_id} AND date::date=${today}::date AND clock_out IS NULL
    `;
    if (!(openRows as any[]).length) return res.status(400).json({ error: 'You are not clocked in.' });
    const open = (openRows[0] as any);

    // Calculate session duration in minutes — handle midnight crossover for night shifts
    const [ih, im] = open.clock_in.split(':').map(Number);
    const [oh, om] = time.split(':').map(Number);
    const inTotalMin  = ih * 60 + im;
    const outTotalMin = oh * 60 + om;
    // If clock-out time is earlier than clock-in, the session crossed midnight (night shift)
    const durationMin = outTotalMin >= inTotalMin
      ? outTotalMin - inTotalMin
      : (24 * 60 - inTotalMin) + outTotalMin;

    // Close the session
    const closedSession = await sql`
      UPDATE attendance_sessions
      SET clock_out=${time}, duration_minutes=${durationMin}
      WHERE id=${open.id} RETURNING *
    `;

    // Recalculate and update attendance_records totals from all sessions
    await recalcAttendanceTotals(employee_id, today);

    // Return the updated attendance record
    const attRows = await sql`SELECT * FROM attendance_records WHERE employee_id=${employee_id} AND date::date=${today}::date`;
    res.json({ session: (closedSession as any[])[0], attendance: (attRows as any[])[0] ?? null });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Biometric sync — eTimeOffice (Vercel mirror) ──────────────────────────

const ET_STATUS_MAP: Record<string, string> = {
  'P':'present','A':'absent','WO':'weekend','H':'holiday','LA':'late','PL':'late',
  'HD':'half-day','L':'on_leave','LV':'on_leave','CL':'on_leave','SL':'on_leave',
  'EL':'on_leave','ML':'on_leave','OD':'present','WFH':'present','CO':'present',
};

// Late if punch-in is more than 1 hour after shift start
// Load shift late_after from DB — never hardcoded so Config changes take effect immediately
async function getShiftLateAfterV(shift: string): Promise<string> {
  try {
    const rows = await sql`SELECT late_after FROM config_shifts WHERE id=${shift}`;
    return (rows[0] as any)?.late_after ?? '10:00';
  } catch { return '10:00'; }
}
function isLateByTime(inTime: string, lateAfter: string): boolean {
  const [lh, lm] = lateAfter.split(':').map(Number);
  const [ch, cm] = inTime.split(':').map(Number);
  return ch > lh || (ch === lh && cm > lm);
}
function parseEtTimeV(t: string|null): string|null {
  if (!t || t.trim()==='--:--' || t.trim()==='00:00') return null;
  return t.trim().slice(0,5);
}
function parseEtWorkTimeV(wt: string|null): number {
  if (!wt || wt==='00:00' || wt==='--:--') return 0;
  const [h,m] = wt.split(':').map(Number);
  return Math.round((h+(m||0)/60)*10)/10;
}

async function runBiometricSyncV(trigger: string, triggeredBy?: string, fromDate?: string, toDate?: string) {
  const apiUrl = process.env.BIOMETRIC_API_URL;
  const apiKey = process.env.BIOMETRIC_API_KEY;
  if (!apiUrl || !apiKey) {
    throw new Error('BIOMETRIC_API_URL and BIOMETRIC_API_KEY environment variables are not configured');
  }
  const today = new Date().toISOString().split('T')[0];
  const from  = fromDate ?? today;
  const to    = toDate   ?? from;
  const label = from === to ? from : `${from} to ${to}`;
  const toEt  = (d: string) => { const [y,m,dy]=d.split('-'); return `${dy}/${m}/${y}`; };

  const fetchRes = await fetch(
    `${apiUrl}?Empcode=ALL&FromDate=${toEt(from)}&ToDate=${toEt(to)}`,
    { headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' } }
  );
  if (!fetchRes.ok) throw new Error(`eTimeOffice API ${fetchRes.status}`);
  const body = await fetchRes.json() as any;
  if (body.Error === true) throw new Error(`eTimeOffice: ${body.Msg ?? 'Unknown'}`);
  const records: any[] = body.InOutPunchData ?? [];

  const empRows = await sql`SELECT id, employee_id, biometric_id, shift FROM employees` as any[];
  const empMap   = new Map<string, string>();
  const shiftMap = new Map<string, string>();
  for (const e of empRows) {
    // Register all reasonable lookup keys so the sync works even if HR forgot
    // to set biometric_id. eTimeOffice typically sends '90' for DL0090, but
    // could also send '090' or '0090' — register all variants.
    const addKey = (k: string | null | undefined) => {
      if (!k) return;
      const s = String(k).trim();
      if (s) empMap.set(s, e.id);
    };
    const empId = String(e.employee_id ?? '').trim();           // "DL0090"
    const noPrefix = empId.replace(/^[A-Za-z]+/, '');            // "0090"
    const noLeading = noPrefix.replace(/^0+/, '') || '0';        // "90"
    addKey(e.biometric_id);   // primary if set
    addKey(empId);            // "DL0090"
    addKey(noPrefix);         // "0090"
    addKey(noLeading);        // "90"
    shiftMap.set(e.id, e.shift ?? 'day');
  }
  // Load late_after per shift from DB — reflects HR config changes
  const shiftCfgRows = await sql`SELECT id, late_after FROM config_shifts` as any[];
  const shiftLateAfter = Object.fromEntries(shiftCfgRows.map((r: any) => [r.id, r.late_after]));

  const syncId = crypto.randomUUID();
  let updated = 0, created = 0;

  for (const rec of records) {
    const empCode = String(rec.Empcode ?? '').trim();
    if (!empCode) continue;
    // Try exact match first, then strip leading zeros as a final fallback
    const iid = empMap.get(empCode)
              ?? empMap.get(empCode.replace(/^0+/, '') || '0');
    if (!iid) continue;
    // Parse DateString DD/MM/YYYY → YYYY-MM-DD
    const rawDs = String(rec.DateString ?? '').trim();
    let recDate = today;
    if (rawDs.includes('/')) { const [rdd,rmm,ry]=rawDs.split('/'); recDate=`${ry}-${rmm}-${rdd}`; }
    const inTime  = parseEtTimeV(rec.INTime);
    const outTime = parseEtTimeV(rec.OUTTime);
    const empShift = shiftMap.get(iid) ?? 'day';
    const lateAfter = shiftLateAfter[empShift] ?? '10:00';
    const status  = inTime
      ? (isLateByTime(inTime, lateAfter) ? 'late' : 'present')
      : (ET_STATUS_MAP[(rec.Status??'A').toUpperCase()] ?? 'absent');
    if (recDate > today) continue; // never store future-date attendance
    if (isWeekendV(recDate)) continue; // Sat/Sun are non-working days
    if (status === 'holiday' && !inTime) continue;
    // Preserve approved WFH — don't let biometric override
    const wfhCheck = await sql`SELECT id FROM wfh_requests WHERE employee_id=${iid} AND date::date=${recDate}::date AND status='approved'`.catch(() => []);
    if ((wfhCheck as any[]).length > 0) continue;
    const hours = parseEtWorkTimeV(rec.WorkTime);
    const ex  = await sql`SELECT * FROM attendance_records WHERE employee_id=${iid} AND date=${recDate}` as any[];
    const had = ex.length > 0; const old = ex[0] ?? {};
    await sql`INSERT INTO attendance_sync_snapshot (sync_id,employee_id,date,had_record,status_before,check_in_before,check_out_before,total_hours_before)
      VALUES(${syncId},${iid},${recDate},${had},${old.status??null},${old.check_in??null},${old.check_out??null},${old.total_hours??null})`;
    const r = await sql`
      INSERT INTO attendance_records (employee_id,date,check_in,check_out,status,total_hours,source,biometric_sync_id)
      VALUES(${iid},${recDate},${inTime},${outTime},${status},${hours},'biometric',${syncId})
      ON CONFLICT(employee_id,date) DO UPDATE SET check_in=EXCLUDED.check_in,check_out=EXCLUDED.check_out,
        status=EXCLUDED.status,total_hours=EXCLUDED.total_hours,source='biometric',biometric_sync_id=${syncId}
      RETURNING (xmax=0) AS was_inserted` as any[];
    if (r[0]?.was_inserted) created++; else updated++;
  }
  await sql`INSERT INTO attendance_sync_log (sync_id,triggered,triggered_by,date_range,records_updated,records_created,status)
    VALUES(${syncId},${trigger},${triggeredBy??null},${label},${updated},${created},'success')`;
  return { sync_id: syncId, records_updated: updated, records_created: created, synced_at: new Date().toISOString(), date_range: label };
}

app.get('/api/attendance/biometric-sync/history', async (_req, res) => {
  try {
    const rows = await sql`SELECT * FROM attendance_sync_log ORDER BY synced_at DESC LIMIT 20`;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/attendance/biometric-sync', async (req, res) => {
  try {
    const result = await runBiometricSyncV('manual', req.body.triggered_by, req.body.from_date, req.body.to_date);
    res.json(result);
  } catch (err: any) {
    const today = new Date().toISOString().split('T')[0];
    try { await sql`INSERT INTO attendance_sync_log (sync_id,triggered,triggered_by,date_range,status,error_msg) VALUES(${crypto.randomUUID()},'manual',${req.body.triggered_by??null},${req.body.from_date??today},'failed',${err.message})`; } catch {}
    res.status(500).json({ error: err.message ?? 'Sync failed' });
  }
});

// ── Leave helpers ─────────────────────────────────────────────────────────
function isOnProbation(joinDate: string | null, probationEndDate?: string | null): boolean {
  if (!joinDate) return false;
  const end = probationEndDate
    ? new Date(probationEndDate)
    : (() => { const d = new Date(joinDate); d.setDate(d.getDate() + 90); return d; })();
  return new Date() < end;
}

const LEAVE_TYPE_ATT_STATUS: Record<string, string> = {
  full_day:    'on_leave',
  half_day:    'half-day',
  short_leave: 'short_leave',
  unpaid:      'unpaid_leave',
  casual:      'on_leave',
  sick:        'on_leave',
  earned:      'on_leave',
};

async function restoreOneDayBalance(employeeId: string, oldAttStatus: string) {
  if (oldAttStatus === 'on_leave') {
    await sql`UPDATE leave_balances SET full_day = full_day + 1 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (oldAttStatus === 'half-day') {
    await sql`UPDATE leave_balances SET short_leave = short_leave + 2 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (oldAttStatus === 'short_leave') {
    await sql`UPDATE leave_balances SET short_leave = short_leave + 1 WHERE employee_id=${employeeId}`.catch(() => {});
  }
}

const IST_MS = 5.5 * 60 * 60 * 1000;
function isWeekendV(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}
function neonDateToStrV(d: string): string {
  if (!d) return '';
  if (!d.includes('T')) return d.slice(0, 10);
  return new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
}
function nextDayV(d: string): string {
  const dt = new Date(d + 'T12:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

async function markLeaveAttendance(employeeId: string, fromDate: string, toDate: string, type: string) {
  const attStatus = LEAVE_TYPE_ATT_STATUS[type] ?? 'on_leave';
  const leaveStatuses = new Set(['on_leave', 'short_leave', 'half-day', 'unpaid_leave']);
  let current = neonDateToStrV(fromDate);
  const end    = neonDateToStrV(toDate);
  while (current <= end) {
    if (isWeekendV(current)) { current = nextDayV(current); continue; } // skip Sat/Sun
    const dateStr = current;
    const existing = await sql`SELECT status FROM attendance_records WHERE employee_id=${employeeId} AND date::date=${dateStr}::date`.catch(() => []);
    const oldStatus = (existing[0] as any)?.status;
    if (oldStatus && leaveStatuses.has(oldStatus) && oldStatus !== attStatus) {
      await restoreOneDayBalance(employeeId, oldStatus);
    }
    await sql`
      INSERT INTO attendance_records (employee_id, date, status, total_hours)
      VALUES (${employeeId}, ${dateStr}, ${attStatus}, 0)
      ON CONFLICT (employee_id, date) DO UPDATE SET status = ${attStatus}
    `.catch(() => {});
    current = nextDayV(current);
  }
}

async function creditMonthlyLeave(employeeId: string, joinDate: string | null) {
  const now = new Date();
  const cm = now.getMonth() + 1;
  const cy = now.getFullYear();
  let balRows = await sql`SELECT * FROM leave_balances WHERE employee_id=${employeeId}`;
  // Auto-create a balance row if one doesn't exist (new employees added directly via UI)
  if (!(balRows as any[]).length) {
    await sql`INSERT INTO leave_balances (employee_id, full_day, short_leave, casual, sick, earned, last_credited_month, last_credited_year, probation_short_used, prev_month_carry_full_day, current_month_credit_full_day) VALUES (${employeeId}, 0, 2, 10, 7, 15, ${cm}, ${cy}, 0, 0, 0) ON CONFLICT (employee_id) DO NOTHING`.catch(() => {});
    return; // just created — no credit needed yet
  }
  const bal = (balRows as any[])[0];
  // Guard: if last_credited fields are set correctly already, skip
  if (Number(bal.last_credited_month) === cm && Number(bal.last_credited_year) === cy) return;
  if (isOnProbation(joinDate)) {
    // No new credit during probation, but we still want short_leave reset to 0 (probation employees use probation_short_used quota separately)
    await sql`UPDATE leave_balances SET last_credited_month=${cm}, last_credited_year=${cy}, prev_month_carry_full_day=COALESCE(full_day, 0), current_month_credit_full_day=0 WHERE employee_id=${employeeId}`;
    return;
  }
  const lastM = bal.last_credited_month ?? cm;
  const lastY = bal.last_credited_year ?? cy;
  const months = Math.max(1, (cy - lastY) * 12 + (cm - lastM));
  // Snapshot what's carrying in BEFORE we add new credit — so employees see the breakdown
  const carryIn = Number(bal.full_day) || 0;
  await sql`UPDATE leave_balances
    SET full_day = ${carryIn} + ${months},
        short_leave = 2,
        last_credited_month = ${cm},
        last_credited_year = ${cy},
        prev_month_carry_full_day = ${carryIn},
        current_month_credit_full_day = ${months}
    WHERE employee_id=${employeeId}`;
}

async function deductLeaveBalance(employeeId: string, type: string, days: number) {
  if (type === 'full_day') {
    await sql`UPDATE leave_balances SET full_day=GREATEST(0,full_day-${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'half_day') {
    await sql`UPDATE leave_balances SET short_leave=GREATEST(0,short_leave-2) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'short_leave') {
    await sql`UPDATE leave_balances SET short_leave=GREATEST(0,short_leave-1) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'casual') {
    await sql`UPDATE leave_balances SET casual=GREATEST(0,casual-${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'sick') {
    await sql`UPDATE leave_balances SET sick=GREATEST(0,sick-${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'earned') {
    await sql`UPDATE leave_balances SET earned=GREATEST(0,earned-${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  }
}

async function restoreLeaveBalance(employeeId: string, type: string, days: number) {
  if (type === 'full_day') {
    await sql`UPDATE leave_balances SET full_day=full_day+${days} WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'half_day') {
    await sql`UPDATE leave_balances SET short_leave=short_leave+2 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'short_leave') {
    await sql`UPDATE leave_balances SET short_leave=short_leave+1 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'casual') {
    await sql`UPDATE leave_balances SET casual=casual+${days} WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'sick') {
    await sql`UPDATE leave_balances SET sick=sick+${days} WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'earned') {
    await sql`UPDATE leave_balances SET earned=earned+${days} WHERE employee_id=${employeeId}`.catch(() => {});
  }
  // 'unpaid' — no balance to restore
}

async function clearLeaveAttendance(employeeId: string, fromDate: string, toDate: string) {
  const leaveStatuses = ['on_leave', 'half-day', 'short_leave', 'unpaid_leave'];
  let current = neonDateToStrV(fromDate);
  const end    = neonDateToStrV(toDate);
  while (current <= end) {
    if (!isWeekendV(current)) {
      await sql`
        DELETE FROM attendance_records
        WHERE employee_id=${employeeId} AND date::date=${current}::date
          AND status = ANY(${leaveStatuses})
      `.catch(() => {});
    }
    current = nextDayV(current);
  }
}

// ── Leave ─────────────────────────────────────────────────────────────────
app.get('/api/leave/requests', async (req, res) => {
  try {
    const { employee_id, status, reporting_manager_id } = req.query as any;
    let rows;
    if (reporting_manager_id) {
      rows = await sql`
        SELECT lr.* FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        WHERE e.reporting_manager_id = ${reporting_manager_id}
          AND lr.manager_status = 'pending' AND lr.status = 'pending'
        ORDER BY lr.applied_on DESC`;
    } else if (employee_id) {
      rows = await sql`SELECT * FROM leave_requests WHERE employee_id=${employee_id} ORDER BY applied_on DESC`;
    } else if (status) {
      rows = await sql`SELECT * FROM leave_requests WHERE status=${status} ORDER BY applied_on DESC`;
    } else {
      rows = await sql`SELECT * FROM leave_requests ORDER BY applied_on DESC`;
    }
    res.json((rows as any[]).map(normDateV));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/leave/requests', async (req, res) => {
  try {
    const { employee_id, employee_name, type, from_date, to_date, days, reason } = req.body;
    const empRows = await sql`SELECT join_date, probation_end_date, reporting_manager_id, date_of_birth FROM employees WHERE id=${employee_id}`.catch(() => []);
    const emp = (empRows as any[])[0] ?? {};
    const onProbation = isOnProbation(emp.join_date ?? null, emp.probation_end_date ?? null);

    // ── Optional leave ────────────────────────────────────────────────────
    if (type === 'optional') {
      if (onProbation) return res.status(400).json({ error: 'Optional leave is not available during the probation period.' });
      const year = new Date(from_date).getFullYear();
      const countRows = await sql`SELECT COUNT(*) FROM leave_requests WHERE employee_id=${employee_id} AND type='optional' AND status NOT IN ('rejected','cancelled') AND EXTRACT(YEAR FROM from_date)=${year}`;
      if (Number((countRows[0] as any).count) >= 2)
        return res.status(400).json({ error: 'You have already used or applied for your 2 optional leaves this year.' });
      const norm = (v: any) => { const s = typeof v==='string'?v:(v instanceof Date?v.toISOString():String(v)); if(s.includes('T')){const d=new Date(s);d.setMinutes(d.getMinutes()+330);return d.toISOString().slice(0,10);} return s.slice(0,10); };
      const pool = await sql`SELECT date FROM optional_leave_dates WHERE year=${year}`;
      const poolSet = new Set((pool as any[]).map(r => norm(r.date)));
      const dobStr = emp.date_of_birth ? norm(emp.date_of_birth) : null;
      const birthday = dobStr ? `${year}-${dobStr.slice(5)}` : null;
      const reqDate = from_date.slice(0,10);
      if (!poolSet.has(reqDate) && birthday !== reqDate)
        return res.status(400).json({ error: 'The selected date is not in the optional leave pool for this year.' });
      const dupe = await sql`SELECT id FROM leave_requests WHERE employee_id=${employee_id} AND type='optional' AND from_date::date=${reqDate}::date AND status NOT IN ('rejected','cancelled')`;
      if ((dupe as any[]).length) return res.status(400).json({ error: 'You have already applied for an optional leave on this date.' });
      const id = `l_${Date.now()}`;
      const rows = await sql`INSERT INTO leave_requests (id,employee_id,employee_name,type,from_date,to_date,days,reason,status,manager_status) VALUES (${id},${employee_id},${employee_name},'optional',${reqDate},${reqDate},1,${reason??''},'pending','pending') RETURNING *`;
      const dateLabel = new Date(reqDate+'T12:00:00Z').toLocaleDateString('en-IN',{day:'numeric',month:'short'});
      const notifMsg = `${employee_name} applied for an optional leave on ${dateLabel}`;
      // Notify manager if one exists
      if (emp.reporting_manager_id) {
        notifyEmployeeUser(emp.reporting_manager_id,'leave_applied','Optional Leave Request', notifMsg).catch(()=>{});
      }
      // Always notify HR/Admin — optional leave is quota-limited and always needs HR visibility
      notifyAdminsAndHR('leave_applied','Optional Leave Request', notifMsg).catch(()=>{});
      return res.status(201).json(rows[0]);
    }

    const isUnpaid = type === 'unpaid';

    if (!isUnpaid && onProbation) {
      if (type === 'full_day') return res.status(400).json({ error: 'Full day leaves are not allowed during the 90-day probation period.' });
      const balRows = await sql`SELECT probation_short_used FROM leave_balances WHERE employee_id=${employee_id}`;
      const used = (balRows[0] as any)?.probation_short_used ?? 0;
      const cost = type === 'half_day' ? 2 : 1;
      if (used + cost > 2) return res.status(400).json({ error: 'Probation leave limit exceeded. You may only take 2 short leaves or 1 half day during probation.' });
      await sql`UPDATE leave_balances SET probation_short_used=${used + cost} WHERE employee_id=${employee_id}`;
    } else if (!isUnpaid) {
      await creditMonthlyLeave(employee_id, emp.join_date ?? null).catch(() => {});
      const balRows = await sql`SELECT full_day, short_leave FROM leave_balances WHERE employee_id=${employee_id}`;
      const bal = (balRows[0] as any) ?? {};
      if (type === 'full_day' && (bal.full_day ?? 0) < 1) return res.status(400).json({ error: 'No full day leave balance available.' });
      if (type === 'half_day' && (bal.short_leave ?? 0) < 2) return res.status(400).json({ error: 'No half day leave balance available.' });
      if (type === 'short_leave' && (bal.short_leave ?? 0) < 1) return res.status(400).json({ error: 'No short leave balance available.' });
    }

    const id = `l_${Date.now()}`;
    const rows = await sql`
      INSERT INTO leave_requests (id, employee_id, employee_name, type, from_date, to_date, days, reason, status, manager_status)
      VALUES (${id}, ${employee_id}, ${employee_name}, ${type}, ${from_date}, ${to_date}, ${days}, ${reason}, 'pending', 'pending')
      RETURNING *`;
    const from = new Date(from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (emp.reporting_manager_id) {
      notifyEmployeeUser(emp.reporting_manager_id, 'leave_applied', 'New Leave Request', `${employee_name} applied for ${type.replace('_',' ')} leave (${from} – ${to})`).catch(()=>{});
    } else {
      notifyAdminsAndHR('leave_applied', 'New Leave Request', `${employee_name} applied for ${type.replace('_',' ')} leave (${from} – ${to})`).catch(()=>{});
    }
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Manager first-level approval
app.patch('/api/leave/requests/:id/manager-approve', async (req, res) => {
  try {
    const { status, manager_id, manager_name, rejection_reason } = req.body;
    if (status === 'rejected') {
      const rows = await sql`
        UPDATE leave_requests
        SET manager_status='rejected', manager_id=${manager_id ?? null},
            manager_name=${manager_name ?? null},
            manager_rejection_reason=${rejection_reason ?? null},
            manager_approved_at=NOW(), status='rejected'
        WHERE id=${req.params.id} RETURNING *`;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const leave = rows[0] as any;
      const empRows = await sql`SELECT join_date FROM employees WHERE id=${leave.employee_id}`.catch(() => []);
      if (isOnProbation((empRows[0] as any)?.join_date ?? null)) {
        const cost = leave.type === 'half_day' ? 2 : 1;
        await sql`UPDATE leave_balances SET probation_short_used=GREATEST(0,probation_short_used-${cost}) WHERE employee_id=${leave.employee_id}`.catch(() => {});
      }
      const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      notifyEmployeeUser(leave.employee_id, 'leave_rejected', 'Leave Rejected by Manager',
        `Your ${leave.type.replace('_',' ')} leave (${from} – ${to}) was rejected by your manager.`);
      return res.json(leave);
    }
    const rows = await sql`
      UPDATE leave_requests
      SET manager_status='approved', manager_id=${manager_id ?? null},
          manager_name=${manager_name ?? null},
          manager_approved_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyAdminsAndHR('leave_applied', 'Leave Needs HR Approval',
      `${leave.employee_name}'s ${leave.type.replace('_',' ')} leave (${from} – ${to}) approved by manager — awaiting your final approval.`);
    res.json(leave);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// HR final approval
app.patch('/api/leave/requests/:id', async (req, res) => {
  try {
    const { status, actioner_name, rejection_reason } = req.body;
    const rows = await sql`
      UPDATE leave_requests
      SET status=${status},
          hr_actioner_name=${actioner_name ?? null},
          hr_actioned_at=NOW(),
          rejection_reason=${status === 'rejected' ? (rejection_reason ?? null) : null}
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    if (status === 'approved') {
      await deductLeaveBalance(leave.employee_id, leave.type, leave.days);
      await markLeaveAttendance(leave.employee_id, leave.from_date, leave.to_date, leave.type);
    } else {
      const empRows = await sql`SELECT join_date FROM employees WHERE id=${leave.employee_id}`.catch(() => []);
      if (isOnProbation((empRows[0] as any)?.join_date ?? null)) {
        const cost = leave.type === 'half_day' ? 2 : 1;
        await sql`UPDATE leave_balances SET probation_short_used=GREATEST(0,probation_short_used-${cost}) WHERE employee_id=${leave.employee_id}`.catch(() => {});
      }
    }
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyEmployeeUser(leave.employee_id, status === 'approved' ? 'leave_approved' : 'leave_rejected',
      status === 'approved' ? 'Leave Approved' : 'Leave Rejected',
      `Your ${leave.type.replace('_',' ')} leave (${from} – ${to}) has been ${status}.`);
    res.json(leave);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Cancel an approved leave — restores balance and clears attendance
app.patch('/api/leave/requests/:id/cancel', async (req, res) => {
  try {
    const { cancelled_by, cancellation_reason } = req.body;
    const existing = await sql`SELECT * FROM leave_requests WHERE id=${req.params.id}`;
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const leave = existing[0] as any;
    if (leave.status !== 'approved') return res.status(400).json({ error: 'Only approved leaves can be cancelled.' });
    const rows = await sql`
      UPDATE leave_requests
      SET status='cancelled', cancelled_by=${cancelled_by ?? null},
          cancelled_at=NOW(), cancellation_reason=${cancellation_reason ?? null}
      WHERE id=${req.params.id} RETURNING *`;
    await restoreLeaveBalance(leave.employee_id, leave.type, leave.days);
    await clearLeaveAttendance(leave.employee_id, leave.from_date, leave.to_date);
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyEmployeeUser(leave.employee_id, 'leave_rejected', 'Leave Cancelled',
      `Your approved ${leave.type.replace('_',' ')} leave (${from} – ${to}) was cancelled by ${cancelled_by ?? 'admin'}.${cancellation_reason ? ' Reason: ' + cancellation_reason : ''}`);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/leave/requests/:id', async (req, res) => {
  try {
    await sql`DELETE FROM leave_requests WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/leave/balances/:employee_id', async (req, res) => {
  try {
    const { full_day, short_leave } = req.body;
    const rows = await sql`
      INSERT INTO leave_balances (employee_id, full_day, short_leave)
      VALUES (${req.params.employee_id}, ${Number(full_day)}, ${Number(short_leave)})
      ON CONFLICT (employee_id) DO UPDATE
        SET full_day = ${Number(full_day)}, short_leave = ${Number(short_leave)}
      RETURNING *`;
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.get('/api/leave/balances/:employee_id', async (req, res) => {
  try {
    const empRows = await sql`SELECT join_date, probation_end_date FROM employees WHERE id=${req.params.employee_id}`.catch(() => []);
    const joinDate = (empRows[0] as any)?.join_date ?? null;
    const probationEndDate = (empRows[0] as any)?.probation_end_date ?? null;
    await creditMonthlyLeave(req.params.employee_id, joinDate).catch(() => {});
    const rows = await sql`SELECT * FROM leave_balances WHERE employee_id=${req.params.employee_id}`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const bal = rows[0] as any;
    bal.on_probation = isOnProbation(joinDate, probationEndDate);
    bal.probation_end_date = probationEndDate ? neonDateToStrV(probationEndDate instanceof Date ? probationEndDate.toISOString() : String(probationEndDate)) : null;
    bal.probation_short_remaining = Math.max(0, 2 - (bal.probation_short_used ?? 0));
    // Add a friendly label for the previous month so the UI can show "carried from April" instead of just a number
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (bal.last_credited_month) {
      const lcm = Number(bal.last_credited_month);
      const lcy = Number(bal.last_credited_year);
      // The carry came from the month *before* the last credited month
      const prevM = lcm === 1 ? 12 : lcm - 1;
      const prevY = lcm === 1 ? lcy - 1 : lcy;
      bal.prev_month_label = `${MONTH_NAMES[prevM - 1]} ${prevY}`;
      bal.current_month_label = `${MONTH_NAMES[lcm - 1]} ${lcy}`;
    }
    res.json(normDateV(bal));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Payroll ───────────────────────────────────────────────────────────────
app.get('/api/payroll', async (req, res) => {
  try {
    const { month, year } = req.query as any;
    let rows;
    if (month && year) {
      rows = await sql`SELECT pr.*, e.name, e.designation, e.avatar, e.employee_id as emp_id, e.department FROM payroll_records pr JOIN employees e ON pr.employee_id=e.id WHERE pr.month=${month} AND pr.year=${Number(year)} ORDER BY e.name`;
    } else {
      rows = await sql`SELECT pr.*, e.name, e.designation, e.avatar, e.employee_id as emp_id, e.department FROM payroll_records pr JOIN employees e ON pr.employee_id=e.id ORDER BY pr.year DESC, pr.month DESC, e.name`;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/payroll/:employee_id', async (req, res) => {
  try {
    res.json(await sql`SELECT * FROM payroll_records WHERE employee_id=${req.params.employee_id} ORDER BY year DESC, month DESC`);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Performance ───────────────────────────────────────────────────────────
app.get('/api/performance/goals', async (req, res) => {
  try {
    const { employee_id } = req.query as any;
    res.json(employee_id
      ? await sql`SELECT * FROM goals WHERE employee_id=${employee_id} ORDER BY due_date`
      : await sql`SELECT * FROM goals ORDER BY due_date`);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/performance/goals/:id', async (req, res) => {
  try {
    const { progress, status } = req.body;
    const rows = await sql`UPDATE goals SET progress=${progress}, status=${status} WHERE id=${req.params.id} RETURNING *`;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/performance/reviews', async (req, res) => {
  try {
    const { employee_id } = req.query as any;
    res.json(employee_id
      ? await sql`SELECT r.*, e.name as reviewer_name FROM reviews r JOIN employees e ON r.reviewer_id=e.id WHERE r.employee_id=${employee_id} ORDER BY r.review_date DESC`
      : await sql`SELECT r.*, e.name as reviewer_name FROM reviews r JOIN employees e ON r.reviewer_id=e.id ORDER BY r.review_date DESC`);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Monthly Performance ───────────────────────────────────────────────────
app.get('/api/performance/monthly', async (req, res) => {
  try {
    const { employee_id, year } = req.query as any;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const rows = year
      ? await sql`SELECT * FROM monthly_performance WHERE employee_id=${employee_id} AND year=${Number(year)} ORDER BY month`
      : await sql`SELECT * FROM monthly_performance WHERE employee_id=${employee_id} ORDER BY year, month`;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Lock / unlock a review (HR locks, only admin unlocks)
app.patch('/api/performance/monthly/:id/lock', async (req, res) => {
  try {
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE`.catch(() => {});
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS locked_by TEXT`.catch(() => {});
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ`.catch(() => {});
    const { lock, locked_by, requester_role } = req.body;
    if (!lock && requester_role !== 'admin') return res.status(403).json({ error: 'Only admins can unlock a review' });
    const rows = await sql`
      UPDATE monthly_performance SET
        is_locked = ${lock ?? true},
        locked_by = ${lock ? (locked_by ?? null) : null},
        locked_at = ${lock ? new Date().toISOString() : null}
      WHERE id = ${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/performance/monthly', async (req, res) => {
  try {
    const { employee_id, reviewer_id, reviewer_name, month, year, productivity, quality, teamwork, attendance_score, initiative, client_satisfaction, ai_usage, overall_score, comments, parameter_notes, requester_role } = req.body;
    const paramNotesJson = JSON.stringify(parameter_notes ?? {});
    // Ensure columns exist (idempotent)
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS ai_usage INTEGER DEFAULT 75`.catch(() => {});
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS parameter_notes JSONB DEFAULT '{}'`.catch(() => {});
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE`.catch(() => {});
    // Block edits on locked reviews for non-admins
    const existing = await sql`SELECT is_locked FROM monthly_performance WHERE employee_id=${employee_id} AND month=${month} AND year=${year}`;
    if ((existing[0] as any)?.is_locked && requester_role !== 'admin') {
      return res.status(403).json({ error: 'This review has been locked by HR and cannot be modified' });
    };
    const rows = await sql`
      INSERT INTO monthly_performance
        (employee_id, reviewer_id, reviewer_name, month, year, productivity, quality, teamwork, attendance_score, initiative, client_satisfaction, ai_usage, overall_score, comments, parameter_notes, updated_at)
      VALUES
        (${employee_id}, ${reviewer_id ?? null}, ${reviewer_name ?? null}, ${month}, ${year},
         ${productivity}, ${quality}, ${teamwork}, ${attendance_score}, ${initiative}, ${client_satisfaction ?? 0}, ${ai_usage ?? 75}, ${overall_score}, ${comments ?? null}, ${paramNotesJson}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        reviewer_id=EXCLUDED.reviewer_id, reviewer_name=EXCLUDED.reviewer_name,
        productivity=EXCLUDED.productivity, quality=EXCLUDED.quality, teamwork=EXCLUDED.teamwork,
        attendance_score=EXCLUDED.attendance_score, initiative=EXCLUDED.initiative,
        client_satisfaction=EXCLUDED.client_satisfaction, ai_usage=EXCLUDED.ai_usage,
        overall_score=EXCLUDED.overall_score, comments=EXCLUDED.comments,
        parameter_notes=EXCLUDED.parameter_notes, updated_at=NOW()
      RETURNING *`;
    const rec = rows[0] as any;
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    notifyEmployeeUser(rec.employee_id, 'review_added', 'Performance Review Added',
      `Your ${MONTHS_SHORT[rec.month - 1]} ${rec.year} performance review is in — overall score: ${rec.overall_score}/100.`
    );
    res.json(rec);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Performance Notes ─────────────────────────────────────────────────────
app.get('/api/performance/notes', async (req, res) => {
  try {
    const { employee_id } = req.query as any;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const rows = await sql`SELECT * FROM performance_notes WHERE employee_id=${employee_id} ORDER BY note_date DESC, created_at DESC`;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/performance/notes', async (req, res) => {
  try {
    const { employee_id, note_date, note_text, note_type, created_by_id, created_by_name } = req.body;
    const rows = await sql`
      INSERT INTO performance_notes (employee_id, note_date, note_text, note_type, created_by_id, created_by_name)
      VALUES (${employee_id}, ${note_date}, ${note_text}, ${note_type ?? 'neutral'}, ${created_by_id ?? null}, ${created_by_name ?? null})
      RETURNING *`;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/performance/notes/:id', async (req, res) => {
  try {
    await sql`DELETE FROM performance_notes WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Appraisal Goals ───────────────────────────────────────────────────────
app.get('/api/performance/appraisal-goals', async (req, res) => {
  try {
    const { employee_id, year } = req.query as any;
    if (employee_id) {
      const rows = await sql`SELECT * FROM appraisal_goals WHERE employee_id=${employee_id} ORDER BY year DESC, month DESC`;
      res.json(rows);
    } else if (year) {
      const rows = await sql`SELECT ag.*, e.name as employee_name, e.designation, e.department FROM appraisal_goals ag JOIN employees e ON ag.employee_id = e.id WHERE ag.year=${Number(year)} ORDER BY e.name, ag.month DESC`;
      res.json(rows);
    } else {
      res.status(400).json({ error: 'employee_id or year is required' });
    }
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/performance/appraisal-goals', async (req, res) => {
  try {
    const { employee_id, year, month, goals } = req.body;
    const rows = await sql`
      INSERT INTO appraisal_goals (employee_id, year, month, goals, updated_at)
      VALUES (${employee_id}, ${year}, ${month}, ${JSON.stringify(goals)}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET goals=EXCLUDED.goals, updated_at=NOW()
      WHERE appraisal_goals.submitted = FALSE
      RETURNING *`;
    if (!rows.length) return res.status(403).json({ error: 'Goals already submitted and locked.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/performance/appraisal-goals/submit', async (req, res) => {
  try {
    const { employee_id, year, month, goals } = req.body;
    const rows = await sql`
      INSERT INTO appraisal_goals (employee_id, year, month, goals, submitted, submitted_at, updated_at)
      VALUES (${employee_id}, ${year}, ${month}, ${JSON.stringify(goals)}, TRUE, NOW(), NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        goals=EXCLUDED.goals, submitted=TRUE, submitted_at=NOW(), updated_at=NOW()
      WHERE appraisal_goals.submitted = FALSE
      RETURNING *`;
    if (!rows.length) return res.status(403).json({ error: 'Already submitted.' });
    const rec = rows[0] as any;
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const empRows = await sql`SELECT name FROM employees WHERE id = ${rec.employee_id}`.catch(() => []);
    const empName = (empRows as any[])[0]?.name ?? 'An employee';
    notifyAdminsAndHR('appraisal_submitted', 'Appraisal Goals Submitted',
      `${empName} submitted ${rec.goals?.length ?? 0} appraisal goal(s) for ${MN[rec.month - 1]} ${rec.year}.`
    );
    res.json(rec);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/performance/appraisal-goals/self-update', async (req, res) => {
  try {
    const { employee_id, year, month, employee_statuses } = req.body;
    const existing = await sql`SELECT * FROM appraisal_goals WHERE employee_id=${employee_id} AND year=${year} AND month=${month}`;
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const goals = [...((existing[0] as any).goals ?? [])];
    for (const { index, employee_status } of (employee_statuses ?? [])) {
      if (goals[index] !== undefined) goals[index] = { ...goals[index], employee_status };
    }
    const rows = await sql`UPDATE appraisal_goals SET goals=${JSON.stringify(goals)}, updated_at=NOW() WHERE employee_id=${employee_id} AND year=${year} AND month=${month} RETURNING *`;
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    notifyAdminsAndHR('self_assessment_updated', 'Self-Assessment Updated',
      `An employee updated their goal self-assessment for ${MN[(month as number) - 1]} ${year}.`
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/performance/appraisal-goals/admin', async (req, res) => {
  try {
    const { employee_id, year, month, goals } = req.body;
    const rows = await sql`
      INSERT INTO appraisal_goals (employee_id, year, month, goals, updated_at)
      VALUES (${employee_id}, ${year}, ${month}, ${JSON.stringify(goals)}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET goals=EXCLUDED.goals, updated_at=NOW()
      RETURNING *`;
    const rec = rows[0] as any;
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    notifyEmployeeUser(employee_id, 'appraisal_reviewed', 'Appraisal Goals Reviewed',
      `Your appraisal goals for ${MN[(month as number) - 1]} ${year} have been reviewed by your manager.`
    );
    res.json(rec);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Notifications ─────────────────────────────────────────────────────────
app.get('/api/notifications', async (req, res) => {
  try {
    const { user_id } = req.query as any;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const rows = await sql`SELECT * FROM notifications WHERE user_id=${user_id} ORDER BY created_at DESC LIMIT 50`;
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/notifications/read-all', async (req, res) => {
  try {
    const { user_id } = req.query as any;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    await sql`UPDATE notifications SET is_read=TRUE WHERE user_id=${user_id} AND is_read=FALSE`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    const rows = await sql`UPDATE notifications SET is_read=TRUE WHERE id=${req.params.id} RETURNING *`;
    res.json(rows[0] ?? { success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/notifications/clear-all', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    await sql`DELETE FROM notifications WHERE user_id=${user_id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    await sql`DELETE FROM notifications WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Config (departments / designations / shifts) ──────────────────────────
async function ensureConfigTables() {
  await sql`CREATE TABLE IF NOT EXISTS config_departments (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS config_designations (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS config_shifts (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, start_time TEXT NOT NULL, end_time TEXT NOT NULL, late_after TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
  // Only seed defaults when the table is empty — prevents deleted departments from reappearing on cold start
  const deptCount = await sql`SELECT COUNT(*) FROM config_departments`;
  if (String((deptCount[0] as any).count) === '0') {
    const depts = ['Engineering','Product','Design','HR','Sales','Finance','Marketing','Operations','Legal','Customer Support'];
    for (const d of depts) {
      await sql`INSERT INTO config_departments (id,name) VALUES (${d.toLowerCase().replace(/\s+/g,'-')},${d}) ON CONFLICT (id) DO NOTHING`;
    }
  }
  // Only seeds if rows don't exist — never overrides HR-configured values
  await sql`INSERT INTO config_shifts (id,name,start_time,end_time,late_after) VALUES ('day','Day Shift','09:00','18:00','10:00') ON CONFLICT (id) DO NOTHING`;
  await sql`INSERT INTO config_shifts (id,name,start_time,end_time,late_after) VALUES ('night','Night Shift','18:30','03:30','19:30') ON CONFLICT (id) DO NOTHING`;
}

app.get('/api/config/departments', async (_req, res) => {
  try { await ensureConfigTables(); res.json(await sql`SELECT * FROM config_departments ORDER BY name`); }
  catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/config/departments', async (req, res) => {
  try {
    await ensureConfigTables();
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const id = name.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
    const rows = await sql`INSERT INTO config_departments (id,name) VALUES (${id},${name.trim()}) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name RETURNING *`;
    res.json(rows[0]);
  } catch (e: any) { res.status(e.message?.includes('unique') ? 409 : 500).json({ error: e.message }); }
});
app.delete('/api/config/departments/:id', async (req, res) => {
  try { await sql`DELETE FROM config_departments WHERE id=${req.params.id}`; res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/config/designations', async (_req, res) => {
  try { await ensureConfigTables(); res.json(await sql`SELECT * FROM config_designations ORDER BY name`); }
  catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/config/designations', async (req, res) => {
  try {
    await ensureConfigTables();
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const id = name.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'') + '-' + Date.now().toString(36);
    const rows = await sql`INSERT INTO config_designations (id,name) VALUES (${id},${name.trim()}) RETURNING *`;
    res.json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/config/designations/:id', async (req, res) => {
  try { await sql`DELETE FROM config_designations WHERE id=${req.params.id}`; res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/config/shifts', async (_req, res) => {
  try { await ensureConfigTables(); res.json(await sql`SELECT * FROM config_shifts ORDER BY start_time`); }
  catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/config/shifts', async (req, res) => {
  try {
    await ensureConfigTables();
    const { name, start_time, end_time, late_after } = req.body;
    if (!name?.trim() || !start_time || !end_time || !late_after) return res.status(400).json({ error: 'All fields required' });
    const id = name.trim().toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
    const rows = await sql`INSERT INTO config_shifts (id,name,start_time,end_time,late_after) VALUES (${id},${name.trim()},${start_time},${end_time},${late_after}) RETURNING *`;
    res.json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.put('/api/config/shifts/:id', async (req, res) => {
  try {
    const { name, start_time, end_time, late_after } = req.body;
    const rows = await sql`UPDATE config_shifts SET name=${name},start_time=${start_time},end_time=${end_time},late_after=${late_after} WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.delete('/api/config/shifts/:id', async (req, res) => {
  try { await sql`DELETE FROM config_shifts WHERE id=${req.params.id}`; res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Optional Leave ────────────────────────────────────────────────────────
async function ensureOptionalLeaveTables() {
  await sql`CREATE TABLE IF NOT EXISTS optional_leave_dates (id TEXT PRIMARY KEY, date DATE NOT NULL, label TEXT NOT NULL, year INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(date,year))`.catch(()=>{});
  await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`.catch(()=>{});
}

app.get('/api/optional-leave/dates', async (req, res) => {
  try {
    await ensureOptionalLeaveTables();
    const year = Number((req.query as any).year) || new Date().getFullYear();
    res.json(await sql`SELECT * FROM optional_leave_dates WHERE year=${year} ORDER BY date ASC`);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/optional-leave/dates', async (req, res) => {
  try {
    await ensureOptionalLeaveTables();
    const { date, label, year } = req.body;
    if (!date || !label?.trim() || !year) return res.status(400).json({ error: 'date, label, year are required' });
    const currentYear = new Date().getFullYear();
    if (Number(year) < currentYear || Number(year) > currentYear + 2)
      return res.status(400).json({ error: `Year must be between ${currentYear} and ${currentYear + 2}` });
    if (date.slice(0,4) !== String(year))
      return res.status(400).json({ error: 'Date must be within the selected year' });
    const id = `old_${Date.now()}`;
    const rows = await sql`INSERT INTO optional_leave_dates (id,date,label,year) VALUES (${id},${date},${label.trim()},${Number(year)}) ON CONFLICT (date,year) DO UPDATE SET label=EXCLUDED.label RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/optional-leave/dates/:id', async (req, res) => {
  try { await sql`DELETE FROM optional_leave_dates WHERE id=${req.params.id}`; res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/optional-leave/available', async (req, res) => {
  try {
    const { employee_id, year: yearStr } = req.query as any;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const year = Number(yearStr) || new Date().getFullYear();
    const pool = await sql`SELECT id,date,label FROM optional_leave_dates WHERE year=${year} ORDER BY date ASC`;
    const empRows = await sql`SELECT date_of_birth FROM employees WHERE id=${employee_id}`;
    const dob = (empRows as any[])[0]?.date_of_birth;

    const norm = (v: any): string => {
      const s = typeof v === 'string' ? v : (v instanceof Date ? v.toISOString() : String(v));
      if (s.includes('T')) { const d = new Date(s); d.setMinutes(d.getMinutes()+330); return d.toISOString().slice(0,10); }
      return s.slice(0,10);
    };

    let birthdayThisYear: string|null = null;
    if (dob) { const s = norm(dob); birthdayThisYear = `${year}-${s.slice(5)}`; }

    // Already applied dates (pending + approved)
    const used = await sql`SELECT from_date FROM leave_requests WHERE employee_id=${employee_id} AND type='optional' AND status NOT IN ('rejected','cancelled') AND EXTRACT(YEAR FROM from_date)=${year}`;
    const usedSet = new Set((used as any[]).map(r => norm(r.from_date)));
    const usedCount = (used as any[]).length;

    const dates: any[] = (pool as any[]).map(r => ({
      id: r.id, date: norm(r.date), label: r.label, is_birthday: false, already_applied: usedSet.has(norm(r.date)),
    }));
    if (birthdayThisYear && !dates.some(d => d.date === birthdayThisYear)) {
      dates.push({ id:'birthday', date:birthdayThisYear, label:'Your Birthday 🎂', is_birthday:true, already_applied:usedSet.has(birthdayThisYear) });
      dates.sort((a,b) => a.date.localeCompare(b.date));
    }
    res.json({ dates, used_count: usedCount, remaining: Math.max(0, 2 - usedCount) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Extend leave apply to handle optional type
// (Handled in the existing /api/leave/requests POST with optional type detection)

// ── Upsell Incentives ─────────────────────────────────────────────────────
app.get('/api/upsell', async (req, res) => {
  try {
    // Create table with nullable requested_amount (no longer used by employees)
    await sql`CREATE TABLE IF NOT EXISTS upsell_requests (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT, client_name TEXT NOT NULL, service_description TEXT NOT NULL, deal_value NUMERIC, requested_amount NUMERIC, notes TEXT, status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT, reviewed_at TIMESTAMPTZ, rejection_reason TEXT, approved_amount NUMERIC, payment_note TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
    // Make requested_amount nullable on existing tables (idempotent)
    await sql`ALTER TABLE upsell_requests ALTER COLUMN requested_amount DROP NOT NULL`.catch(()=>{});
    const { employee_id } = req.query as any;
    const rows = employee_id
      ? await sql`SELECT * FROM upsell_requests WHERE employee_id=${employee_id} ORDER BY created_at DESC`
      : await sql`SELECT * FROM upsell_requests ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/upsell', async (req, res) => {
  try {
    const { employee_id, employee_name, client_name, service_description, deal_value, notes } = req.body;
    if (!employee_id || !client_name?.trim() || !service_description?.trim())
      return res.status(400).json({ error: 'employee_id, client_name, service_description are required' });
    // Validate deal_value is positive if provided
    if (deal_value !== undefined && deal_value !== null && Number(deal_value) <= 0)
      return res.status(400).json({ error: 'Deal value must be greater than 0' });
    const id = `ups_${Date.now()}`;
    const rows = await sql`INSERT INTO upsell_requests (id,employee_id,employee_name,client_name,service_description,deal_value,notes) VALUES (${id},${employee_id},${employee_name??null},${client_name.trim()},${service_description.trim()},${deal_value??null},${notes?.trim()??null}) RETURNING *`;
    notifyAdminsAndHR('upsell_submitted','Upsell Incentive Request',
      `${employee_name??'An employee'} reported an upsell for "${client_name.trim()}"${deal_value ? ` — Deal: ₹${Number(deal_value).toLocaleString('en-IN')}` : ''}. Set their incentive amount.`).catch(()=>{});
    res.status(201).json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/upsell/:id', async (req, res) => {
  try {
    const { status, reviewed_by, rejection_reason, approved_amount, payment_note } = req.body;
    // Validate status is a known value
    if (!['approved','rejected','paid'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    // Incentive approval requires an amount > 0
    if (status === 'approved' && (!approved_amount || Number(approved_amount) <= 0))
      return res.status(400).json({ error: 'approved_amount is required and must be greater than 0' });
    // Fetch current status to prevent invalid transitions
    const current = await sql`SELECT status FROM upsell_requests WHERE id=${req.params.id}`;
    if (!(current as any[]).length) return res.status(404).json({ error: 'Not found' });
    const currentStatus = (current[0] as any).status;
    if (currentStatus === 'paid') return res.status(400).json({ error: 'Paid requests cannot be changed' });
    if (currentStatus === 'approved' && status === 'approved') return res.status(400).json({ error: 'Already approved' });
    const rows = await sql`UPDATE upsell_requests SET status=${status},reviewed_by=${reviewed_by??null},reviewed_at=NOW(),rejection_reason=${status==='rejected'?(rejection_reason??null):null},approved_amount=${approved_amount??null},payment_note=${payment_note??null} WHERE id=${req.params.id} RETURNING *`;
    if (!(rows as any[]).length) return res.status(404).json({ error: 'Not found' });
    const r = rows[0] as any;
    if (status === 'approved') {
      notifyEmployeeUser(r.employee_id,'upsell_approved','Incentive Request Approved 🎉',`Your upsell request for "${r.client_name}" is approved! Incentive: ₹${Number(approved_amount).toLocaleString('en-IN')}.`).catch(()=>{});
    } else if (status === 'rejected') {
      notifyEmployeeUser(r.employee_id,'upsell_rejected','Incentive Request Not Approved',`Your upsell request for "${r.client_name}" was not approved.${rejection_reason?` Reason: ${rejection_reason}`:''}`).catch(()=>{});
    } else if (status === 'paid') {
      notifyEmployeeUser(r.employee_id,'upsell_paid','Incentive Payment Processed 💰',`Your incentive of ₹${Number(r.approved_amount).toLocaleString('en-IN')} for "${r.client_name}" has been paid.${payment_note?` Note: ${payment_note}`:''}`).catch(()=>{});
    }
    res.json(r);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Expenses ──────────────────────────────────────────────────────────────
const EXPENSE_CATS = ['Travel','Food & Meals','Equipment','Software','Marketing','Training','Other'];
app.get('/api/expenses/categories', (_req, res) => res.json(EXPENSE_CATS));
app.get('/api/expenses', async (req, res) => {
  try {
    await sql`CREATE TABLE IF NOT EXISTS expense_requests (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT, category TEXT NOT NULL, description TEXT NOT NULL, amount NUMERIC NOT NULL, receipt_note TEXT, expense_date DATE, status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT, reviewed_at TIMESTAMPTZ, rejection_reason TEXT, approved_amount NUMERIC, payment_note TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
    const { employee_id } = req.query as any;
    const rows = employee_id ? await sql`SELECT * FROM expense_requests WHERE employee_id=${employee_id} ORDER BY created_at DESC` : await sql`SELECT * FROM expense_requests ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/expenses', async (req, res) => {
  try {
    const { employee_id, employee_name, category, description, amount, receipt_note, expense_date } = req.body;
    if (!employee_id || !category || !description?.trim() || !amount)
      return res.status(400).json({ error: 'category, description, amount are required' });
    if (Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });
    // Reject future expense dates
    if (expense_date && expense_date > new Date().toISOString().slice(0, 10))
      return res.status(400).json({ error: 'Expense date cannot be in the future' });
    const id = `exp_${Date.now()}`;
    const rows = await sql`INSERT INTO expense_requests (id,employee_id,employee_name,category,description,amount,receipt_note,expense_date) VALUES (${id},${employee_id},${employee_name??null},${category},${description.trim()},${amount},${receipt_note?.trim()??null},${expense_date??null}) RETURNING *`;
    notifyAdminsAndHR('expense_submitted','Expense Claim Submitted',`${employee_name??'An employee'} submitted a ${category} expense of ₹${Number(amount).toLocaleString('en-IN')}.`).catch(()=>{});
    res.status(201).json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/expenses/:id', async (req, res) => {
  try {
    const { status, reviewed_by, rejection_reason, approved_amount, payment_note } = req.body;
    if (!['approved','rejected','paid'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    // Fetch current record to validate transition
    const current = await sql`SELECT status, amount FROM expense_requests WHERE id=${req.params.id}`;
    if (!(current as any[]).length) return res.status(404).json({ error: 'Not found' });
    const cur = current[0] as any;
    if (cur.status === 'paid') return res.status(400).json({ error: 'Paid expenses cannot be changed' });
    if (cur.status === 'rejected' && status === 'paid') return res.status(400).json({ error: 'Cannot pay a rejected expense' });
    if (cur.status === 'approved' && status === 'approved') return res.status(400).json({ error: 'Already approved' });
    if (approved_amount !== undefined && approved_amount !== null && Number(approved_amount) <= 0)
      return res.status(400).json({ error: 'Approved amount must be greater than 0' });
    const rows = await sql`UPDATE expense_requests SET status=${status},reviewed_by=${reviewed_by??null},reviewed_at=NOW(),rejection_reason=${status==='rejected'?(rejection_reason??null):null},approved_amount=${approved_amount??null},payment_note=${payment_note??null} WHERE id=${req.params.id} RETURNING *`;
    if (!(rows as any[]).length) return res.status(404).json({ error: 'Not found' });
    const e = rows[0] as any;
    const displayAmt = approved_amount ?? e.amount;
    if (status==='approved') notifyEmployeeUser(e.employee_id,'expense_approved','Expense Approved ✅',`Your ${e.category} expense of ₹${Number(displayAmt).toLocaleString('en-IN')} has been approved.`).catch(()=>{});
    else if (status==='rejected') notifyEmployeeUser(e.employee_id,'expense_rejected','Expense Not Approved',`Your ${e.category} expense was not approved.${rejection_reason?` Reason: ${rejection_reason}`:''}`).catch(()=>{});
    else if (status==='paid') notifyEmployeeUser(e.employee_id,'expense_paid','Expense Reimbursed 💸',`Your ${e.category} expense of ₹${Number(e.approved_amount??e.amount).toLocaleString('en-IN')} has been reimbursed.${payment_note?` Note: ${payment_note}`:''}`).catch(()=>{});
    res.json(e);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── IT Asset & Repairs ────────────────────────────────────────────────────
// Approval threshold: repairs costing more than this require admin approval before being marked paid
const REPAIR_APPROVAL_THRESHOLD = 10000;

async function ensureRepairTables() {
  await sql`CREATE TABLE IF NOT EXISTS vendors (id TEXT PRIMARY KEY, name TEXT NOT NULL, contact_person TEXT, phone TEXT, email TEXT, gst_no TEXT, address TEXT, notes TEXT, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
  await sql`CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, asset_tag TEXT UNIQUE NOT NULL, model TEXT, serial_no TEXT, purchase_date DATE, assigned_to_id TEXT, assigned_to_name TEXT, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
  await sql`CREATE TABLE IF NOT EXISTS repair_tickets (id TEXT PRIMARY KEY, asset_id TEXT, laptop_info TEXT, employee_id TEXT, employee_name TEXT, vendor_id TEXT, issue TEXT NOT NULL, status TEXT DEFAULT 'reported', quoted_cost NUMERIC, final_cost NUMERIC, requires_approval BOOLEAN DEFAULT FALSE, approved_by TEXT, approved_at TIMESTAMPTZ, rejected_by TEXT, rejected_at TIMESTAMPTZ, rejection_reason TEXT, payment_status TEXT DEFAULT 'unpaid', payment_mode TEXT, payment_date DATE, notes TEXT, reported_at TIMESTAMPTZ DEFAULT NOW(), picked_up_at TIMESTAMPTZ, returned_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, created_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
}

// ── Vendors ───────────────────────────────────────────────────────────────
app.get('/api/vendors', async (_req, res) => {
  try {
    await ensureRepairTables();
    res.json(await sql`SELECT * FROM vendors ORDER BY created_at DESC`);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/vendors', async (req, res) => {
  try {
    await ensureRepairTables();
    const { name, contact_person, phone, email, gst_no, address, notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Vendor name is required' });
    const id = `vend_${Date.now()}`;
    const rows = await sql`INSERT INTO vendors (id, name, contact_person, phone, email, gst_no, address, notes) VALUES (${id}, ${name.trim()}, ${contact_person ?? null}, ${phone ?? null}, ${email ?? null}, ${gst_no ?? null}, ${address ?? null}, ${notes ?? null}) RETURNING *`;
    res.status(201).json((rows as any[])[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.put('/api/vendors/:id', async (req, res) => {
  try {
    const { name, contact_person, phone, email, gst_no, address, notes, active } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Vendor name is required' });
    const rows = await sql`UPDATE vendors SET name=${name.trim()}, contact_person=${contact_person ?? null}, phone=${phone ?? null}, email=${email ?? null}, gst_no=${gst_no ?? null}, address=${address ?? null}, notes=${notes ?? null}, active=${active ?? true} WHERE id=${req.params.id} RETURNING *`;
    if (!(rows as any[]).length) return res.status(404).json({ error: 'Vendor not found' });
    res.json((rows as any[])[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/vendors/:id', async (req, res) => {
  try {
    await sql`DELETE FROM vendors WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Assets ────────────────────────────────────────────────────────────────
app.get('/api/assets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { assigned_to_id } = req.query as any;
    if (assigned_to_id) {
      res.json(await sql`SELECT * FROM assets WHERE assigned_to_id=${assigned_to_id} ORDER BY asset_tag ASC`);
    } else {
      res.json(await sql`SELECT * FROM assets ORDER BY asset_tag ASC`);
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/assets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { asset_tag, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes } = req.body;
    if (!asset_tag?.trim()) return res.status(400).json({ error: 'Asset tag is required' });
    const id = `asset_${Date.now()}`;
    const rows = await sql`INSERT INTO assets (id, asset_tag, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes) VALUES (${id}, ${asset_tag.trim()}, ${model ?? null}, ${serial_no ?? null}, ${purchase_date ?? null}, ${assigned_to_id ?? null}, ${assigned_to_name ?? null}, ${status ?? 'active'}, ${notes ?? null}) RETURNING *`;
    res.status(201).json((rows as any[])[0]);
  } catch (e: any) {
    if (e.message?.includes('unique')) return res.status(409).json({ error: 'Asset tag already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/assets/:id', async (req, res) => {
  try {
    const { asset_tag, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes } = req.body;
    if (!asset_tag?.trim()) return res.status(400).json({ error: 'Asset tag is required' });
    const rows = await sql`UPDATE assets SET asset_tag=${asset_tag.trim()}, model=${model ?? null}, serial_no=${serial_no ?? null}, purchase_date=${purchase_date ?? null}, assigned_to_id=${assigned_to_id ?? null}, assigned_to_name=${assigned_to_name ?? null}, status=${status ?? 'active'}, notes=${notes ?? null} WHERE id=${req.params.id} RETURNING *`;
    if (!(rows as any[]).length) return res.status(404).json({ error: 'Asset not found' });
    res.json((rows as any[])[0]);
  } catch (e: any) {
    if (e.message?.includes('unique') || e.message?.includes('duplicate')) {
      return res.status(409).json({ error: 'Asset tag already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/assets/:id', async (req, res) => {
  try {
    await sql`DELETE FROM assets WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Repair tickets ────────────────────────────────────────────────────────
app.get('/api/repair-tickets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { employee_id } = req.query as any;
    if (employee_id) {
      res.json(await sql`SELECT * FROM repair_tickets WHERE employee_id=${employee_id} ORDER BY reported_at DESC`);
    } else {
      res.json(await sql`SELECT * FROM repair_tickets ORDER BY reported_at DESC`);
    }
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/repair-tickets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { asset_id, laptop_info, employee_id, employee_name, vendor_id, issue, quoted_cost, notes, created_by } = req.body;
    if (!issue?.trim()) return res.status(400).json({ error: 'Issue description is required' });
    if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
    if (quoted_cost != null && quoted_cost !== '' && Number(quoted_cost) < 0) {
      return res.status(400).json({ error: 'Cost cannot be negative' });
    }
    // Prevent multiple open tickets for the same asset — keeps asset.status consistent
    if (asset_id) {
      const openRows = await sql`SELECT id FROM repair_tickets WHERE asset_id=${asset_id} AND status NOT IN ('paid','cancelled')`;
      if ((openRows as any[]).length > 0) {
        return res.status(409).json({ error: 'This asset already has an open repair ticket. Close or cancel the existing one first.' });
      }
    }
    const id = `rep_${Date.now()}`;
    const rows = await sql`INSERT INTO repair_tickets (id, asset_id, laptop_info, employee_id, employee_name, vendor_id, issue, quoted_cost, notes, created_by) VALUES (${id}, ${asset_id ?? null}, ${laptop_info ?? null}, ${employee_id}, ${employee_name ?? null}, ${vendor_id ?? null}, ${issue.trim()}, ${quoted_cost ?? null}, ${notes ?? null}, ${created_by ?? null}) RETURNING *`;
    // Mark asset as in_repair if linked
    if (asset_id) await sql`UPDATE assets SET status='in_repair' WHERE id=${asset_id}`.catch(()=>{});
    const ticket = (rows as any[])[0];
    // Notifications
    notifyAdminsAndHR('repair_ticket_created', 'New Repair Ticket', `${employee_name ?? 'An employee'}'s laptop reported for repair: ${issue.trim().slice(0, 60)}${issue.length > 60 ? '…' : ''}`).catch(()=>{});
    if (employee_id) notifyEmployeeUser(employee_id, 'repair_ticket_created', 'Repair Ticket Logged', `Your laptop has been logged for repair. Issue: ${issue.trim().slice(0, 60)}${issue.length > 60 ? '…' : ''}`).catch(()=>{});
    res.status(201).json(ticket);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Status transition + edits
app.patch('/api/repair-tickets/:id', async (req, res) => {
  try {
    const { status, asset_id, laptop_info, vendor_id, issue, quoted_cost, final_cost, payment_mode, payment_date, notes, updated_by_role } = req.body;
    if (quoted_cost != null && quoted_cost !== '' && Number(quoted_cost) < 0) {
      return res.status(400).json({ error: 'Quoted cost cannot be negative' });
    }
    if (final_cost != null && final_cost !== '' && Number(final_cost) < 0) {
      return res.status(400).json({ error: 'Final cost cannot be negative' });
    }
    const current = await sql`SELECT * FROM repair_tickets WHERE id=${req.params.id}` as any[];
    if (!current.length) return res.status(404).json({ error: 'Ticket not found' });
    const t = current[0];

    // Build the update incrementally — only fields provided in the body
    const updates: any = {
      asset_id:    asset_id    !== undefined ? asset_id    : t.asset_id,
      laptop_info: laptop_info !== undefined ? laptop_info : t.laptop_info,
      vendor_id:   vendor_id   !== undefined ? vendor_id   : t.vendor_id,
      issue:       issue       !== undefined ? issue       : t.issue,
      quoted_cost: quoted_cost !== undefined ? quoted_cost : t.quoted_cost,
      final_cost:  final_cost  !== undefined ? final_cost  : t.final_cost,
      payment_mode: payment_mode !== undefined ? payment_mode : t.payment_mode,
      payment_date: payment_date !== undefined ? payment_date : t.payment_date,
      notes:       notes       !== undefined ? notes       : t.notes,
    };

    // Status transitions — track timestamp on each move
    let newStatus = status ?? t.status;
    let pickedUpAt = t.picked_up_at, returnedAt = t.returned_at, paidAt = t.paid_at, cancelledAt = t.cancelled_at;
    let requiresApproval = t.requires_approval;

    if (status && status !== t.status) {
      const now = new Date().toISOString();
      if (status === 'picked_up')        pickedUpAt = now;
      else if (status === 'returned')    returnedAt = now;
      else if (status === 'cancelled')   cancelledAt = now;
      else if (status === 'paid') {
        // Approval check — admin can pay anything; HR needs admin approval above threshold
        const cost = Number(updates.final_cost ?? updates.quoted_cost ?? 0);
        if (cost > REPAIR_APPROVAL_THRESHOLD && updated_by_role !== 'admin' && !t.approved_at) {
          newStatus = 'awaiting_approval';
          requiresApproval = true;
          notifyAdminsAndHR('repair_approval_needed', 'Repair Payment Needs Approval',
            `${t.employee_name}'s laptop repair of ₹${Number(cost).toLocaleString('en-IN')} exceeds the ₹${REPAIR_APPROVAL_THRESHOLD.toLocaleString('en-IN')} threshold and needs admin approval.`).catch(()=>{});
        } else {
          paidAt = now;
        }
      }
    }

    const upd = await sql`
      UPDATE repair_tickets SET
        status=${newStatus},
        asset_id=${updates.asset_id}, laptop_info=${updates.laptop_info},
        vendor_id=${updates.vendor_id}, issue=${updates.issue},
        quoted_cost=${updates.quoted_cost}, final_cost=${updates.final_cost},
        payment_mode=${updates.payment_mode}, payment_date=${updates.payment_date},
        notes=${updates.notes},
        requires_approval=${requiresApproval},
        payment_status=${newStatus === 'paid' ? 'paid' : t.payment_status},
        picked_up_at=${pickedUpAt}, returned_at=${returnedAt},
        paid_at=${paidAt}, cancelled_at=${cancelledAt},
        updated_at=NOW()
      WHERE id=${req.params.id} RETURNING *
    ` as any[];

    const updated = upd[0];

    // Mark asset status accordingly
    if (updated.asset_id) {
      if (newStatus === 'returned' || newStatus === 'paid')
        await sql`UPDATE assets SET status='active' WHERE id=${updated.asset_id}`.catch(()=>{});
      else if (newStatus === 'picked_up')
        await sql`UPDATE assets SET status='in_repair' WHERE id=${updated.asset_id}`.catch(()=>{});
      else if (newStatus === 'cancelled')
        await sql`UPDATE assets SET status='active' WHERE id=${updated.asset_id}`.catch(()=>{});
    }

    // Notifications on status change
    if (status && status !== t.status && updated.employee_id) {
      const msgs: Record<string, string> = {
        picked_up: 'Your laptop has been picked up by the vendor for repair.',
        returned:  'Your laptop has been returned. Please verify it.',
        paid:      'Your laptop repair has been marked as paid. All done!',
        cancelled: 'Your repair ticket has been cancelled.',
        awaiting_approval: 'Your repair payment is awaiting admin approval due to high cost.',
      };
      if (msgs[newStatus]) {
        notifyEmployeeUser(updated.employee_id, `repair_${newStatus}`, 'Laptop Repair Update', msgs[newStatus]).catch(()=>{});
      }
    }

    res.json(updated);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Admin approve — moves awaiting_approval → paid
app.patch('/api/repair-tickets/:id/approve', async (req, res) => {
  try {
    const { approved_by } = req.body;
    const rows = await sql`UPDATE repair_tickets SET status='paid', payment_status='paid', approved_by=${approved_by ?? null}, approved_at=NOW(), paid_at=NOW(), updated_at=NOW() WHERE id=${req.params.id} RETURNING *` as any[];
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const t = rows[0];
    if (t.asset_id) await sql`UPDATE assets SET status='active' WHERE id=${t.asset_id}`.catch(()=>{});
    if (t.employee_id) notifyEmployeeUser(t.employee_id, 'repair_paid', 'Laptop Repair Update', `Your laptop repair payment has been approved and marked as paid.`).catch(()=>{});
    notifyAdminsAndHR('repair_paid', 'Repair Payment Approved', `${t.employee_name}'s repair (₹${Number(t.final_cost ?? 0).toLocaleString('en-IN')}) approved & paid.`).catch(()=>{});
    res.json(t);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Admin reject — moves awaiting_approval → returned (HR can retry with revised cost)
app.patch('/api/repair-tickets/:id/reject', async (req, res) => {
  try {
    const { rejected_by, rejection_reason } = req.body;
    const rows = await sql`UPDATE repair_tickets SET status='returned', rejected_by=${rejected_by ?? null}, rejected_at=NOW(), rejection_reason=${rejection_reason ?? null}, requires_approval=FALSE, updated_at=NOW() WHERE id=${req.params.id} RETURNING *` as any[];
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const t = rows[0];
    notifyAdminsAndHR('repair_rejected', 'Repair Payment Rejected', `${t.employee_name}'s repair payment was rejected by ${rejected_by}.${rejection_reason ? ' Reason: ' + rejection_reason : ''}`).catch(()=>{});
    res.json(t);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/repair-tickets/:id', async (req, res) => {
  try {
    const rows = await sql`SELECT asset_id FROM repair_tickets WHERE id=${req.params.id}` as any[];
    await sql`DELETE FROM repair_tickets WHERE id=${req.params.id}`;
    if (rows[0]?.asset_id) await sql`UPDATE assets SET status='active' WHERE id=${rows[0].asset_id}`.catch(()=>{});
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Warnings & PIP ────────────────────────────────────────────────────────
async function ensureWarningsTables() {
  await sql`CREATE TABLE IF NOT EXISTS employee_warnings (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT, reason TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'warning', issued_by TEXT, issued_by_role TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
  await sql`CREATE TABLE IF NOT EXISTS employee_pips (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT, start_date DATE NOT NULL, end_date DATE NOT NULL, reason TEXT, goals TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
}
app.get('/api/warnings', async (req, res) => {
  try {
    await ensureWarningsTables();
    const { employee_id } = req.query as any;
    const rows = employee_id ? await sql`SELECT * FROM employee_warnings WHERE employee_id=${employee_id} ORDER BY created_at DESC` : await sql`SELECT * FROM employee_warnings ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/warnings', async (req, res) => {
  try {
    await ensureWarningsTables();
    const { employee_id, employee_name, reason, severity, issued_by, issued_by_role } = req.body;
    if (!employee_id || !reason?.trim()) return res.status(400).json({ error: 'employee_id and reason required' });
    const id = `warn_${Date.now()}`;
    const rows = await sql`INSERT INTO employee_warnings (id,employee_id,employee_name,reason,severity,issued_by,issued_by_role) VALUES (${id},${employee_id},${employee_name??null},${reason.trim()},${severity??'warning'},${issued_by??null},${issued_by_role??null}) RETURNING *`;
    const warn = rows[0] as any;
    const sevLabel = (severity??'warning').charAt(0).toUpperCase()+(severity??'warning').slice(1);

    // 1. Notify the employee
    notifyEmployeeUser(employee_id, 'warning_issued',
      `${sevLabel} Warning Issued`,
      `A ${severity??'warning'} warning has been issued by ${issued_by??'HR/Admin'}. Reason: ${reason.trim()}`
    ).catch(()=>{});
    // 2. Manager issued → notify HR/Admin
    if (issued_by_role==='manager'||issued_by_role==='employee') {
      notifyAdminsAndHR('warning_issued','Warning Issued by Manager',
        `${issued_by??'A manager'} issued a ${severity??'warning'} warning to ${employee_name??'an employee'}. Reason: ${reason.trim()}`
      ).catch(()=>{});
    }
    // 3. HR/Admin issued → notify reporting manager
    if (issued_by_role==='admin'||issued_by_role==='hr_manager') {
      notifyManagerOfEmployee(employee_id,'warning_issued','Warning Issued to Your Team Member',
        `HR issued a ${severity??'warning'} warning to ${employee_name??'your team member'}. Reason: ${reason.trim()}`
      ).catch(()=>{});
    }

    // Auto-trigger PIP on 3rd warning
    const allWarns = await sql`SELECT id FROM employee_warnings WHERE employee_id=${employee_id}`;
    if ((allWarns as any[]).length >= 3) {
      const active = await sql`SELECT id FROM employee_pips WHERE employee_id=${employee_id} AND status='active'`;
      if (!(active as any[]).length) {
        const pid=`pip_${Date.now()}`; const today=new Date().toISOString().split('T')[0];
        const ed=new Date(); ed.setMonth(ed.getMonth()+1); const end=ed.toISOString().split('T')[0];
        await sql`INSERT INTO employee_pips (id,employee_id,employee_name,start_date,end_date,reason,status) VALUES (${pid},${employee_id},${employee_name??null},${today},${end},'Automatically triggered after 3 warnings','active')`;
        notifyEmployeeUser(employee_id,'pip_assigned','Performance Improvement Plan Assigned',
          `You have been placed on a PIP effective ${today} for 1 month. Please speak to your HR manager.`).catch(()=>{});
        notifyAdminsAndHR('pip_assigned','PIP Auto-Triggered',
          `${employee_name??'An employee'} has been placed on a PIP after 3 warnings.`).catch(()=>{});
        notifyManagerOfEmployee(employee_id,'pip_assigned','Team Member Placed on PIP',
          `${employee_name??'Your team member'} has been placed on a PIP after 3 warnings.`).catch(()=>{});
      }
    }
    res.status(201).json(warn);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/warnings/:id', async (req, res) => {
  try { await sql`DELETE FROM employee_warnings WHERE id=${req.params.id}`; res.json({ success: true }); }
  catch { res.status(500).json({ error: 'Server error' }); }
});
app.get('/api/warnings/pips', async (req, res) => {
  try {
    await ensureWarningsTables();
    const { employee_id } = req.query as any;
    const rows = employee_id ? await sql`SELECT * FROM employee_pips WHERE employee_id=${employee_id} ORDER BY created_at DESC` : await sql`SELECT * FROM employee_pips ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.patch('/api/warnings/pips/:id', async (req, res) => {
  try {
    const { status, goals } = req.body;
    const rows = await sql`UPDATE employee_pips SET status=${status??'active'},goals=${goals??null} WHERE id=${req.params.id} RETURNING *`;
    if (!(rows as any[]).length) return res.status(404).json({ error: 'Not found' });
    res.json((rows as any[])[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── WFH ───────────────────────────────────────────────────────────────────
async function ensureWfhTable() {
  await sql`CREATE TABLE IF NOT EXISTS wfh_requests (
    id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, employee_name TEXT,
    date DATE NOT NULL, type TEXT NOT NULL DEFAULT 'full_day', reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending', manager_status TEXT NOT NULL DEFAULT 'pending',
    manager_id TEXT, manager_name TEXT, manager_approved_at TIMESTAMPTZ,
    manager_rejection_reason TEXT, hr_actioner_name TEXT, hr_actioned_at TIMESTAMPTZ,
    rejection_reason TEXT, cancelled_by TEXT, cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT, applied_on TIMESTAMPTZ DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
}
app.get('/api/wfh/requests', async (req, res) => {
  try {
    await ensureWfhTable();
    const { employee_id, status, reporting_manager_id } = req.query as any;
    let rows;
    if (reporting_manager_id) {
      rows = await sql`SELECT wr.* FROM wfh_requests wr JOIN employees e ON e.id=wr.employee_id WHERE e.reporting_manager_id=${reporting_manager_id} AND wr.manager_status='pending' AND wr.status='pending' ORDER BY wr.applied_on DESC`;
    } else if (employee_id) {
      rows = await sql`SELECT * FROM wfh_requests WHERE employee_id=${employee_id} ORDER BY applied_on DESC`;
    } else if (status) {
      rows = await sql`SELECT * FROM wfh_requests WHERE status=${status} ORDER BY applied_on DESC`;
    } else {
      rows = await sql`SELECT * FROM wfh_requests ORDER BY applied_on DESC`;
    }
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/wfh/requests', async (req, res) => {
  try {
    await ensureWfhTable();
    const { employee_id, employee_name, date, type, reason } = req.body;
    // Block WFH during probation
    const empRows = await sql`SELECT join_date, probation_end_date FROM employees WHERE id=${employee_id}` as any[];
    if (empRows.length) {
      const { join_date, probation_end_date } = empRows[0];
      const pend = probation_end_date
        ? new Date(probation_end_date instanceof Date ? probation_end_date.toISOString() : String(probation_end_date))
        : (() => { const d = new Date(join_date instanceof Date ? join_date.toISOString() : String(join_date)); d.setDate(d.getDate()+90); return d; })();
      if (new Date() < pend) return res.status(403).json({ error: 'Work From Home is not available during the probation period.' });
    }
    const id = `wfh_${Date.now()}`;
    const rows = await sql`INSERT INTO wfh_requests (id,employee_id,employee_name,date,type,reason) VALUES (${id},${employee_id},${employee_name??null},${date},${type},${reason??null}) RETURNING *`;
    // Notify manager that their report applied for WFH
    notifyManagerOfEmployee(employee_id,'wfh_applied','WFH Request',
      `${employee_name??'Employee'} applied for ${type==='half_day'?'Half Day':'Full Day'} Work From Home.`).catch(()=>{});
    // Also notify HR/Admin
    notifyAdminsAndHR('wfh_applied','WFH Request Submitted',
      `${employee_name??'An employee'} has applied for ${type==='half_day'?'Half Day':'Full Day'} WFH — awaiting manager approval.`).catch(()=>{});
    res.status(201).json(rows[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.patch('/api/wfh/requests/:id/manager-approve', async (req, res) => {
  try {
    const { status, manager_id, manager_name, rejection_reason } = req.body;
    if (status === 'rejected') {
      const rows = await sql`UPDATE wfh_requests SET manager_status='rejected',manager_id=${manager_id??null},manager_name=${manager_name??null},manager_approved_at=NOW(),manager_rejection_reason=${rejection_reason??null},status='rejected' WHERE id=${req.params.id} RETURNING *`;
      const w = rows[0] as any;
      notifyEmployeeUser(w.employee_id,'wfh_rejected','WFH Request Rejected by Manager',`Your Work From Home request was rejected by your manager.`).catch(()=>{});
      return res.json(w);
    }
    const rows = await sql`UPDATE wfh_requests SET manager_status='approved',manager_id=${manager_id??null},manager_name=${manager_name??null},manager_approved_at=NOW() WHERE id=${req.params.id} RETURNING *`;
    const w = rows[0] as any;
    notifyAdminsAndHR('wfh_applied','WFH Needs HR Approval',
      `${w.employee_name}'s WFH request approved by manager — awaiting final HR approval.`).catch(()=>{});
    res.json(w);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.patch('/api/wfh/requests/:id', async (req, res) => {
  try {
    const { status, actioner_name, rejection_reason } = req.body;
    const rows = await sql`UPDATE wfh_requests SET status=${status},hr_actioner_name=${actioner_name??null},hr_actioned_at=NOW(),rejection_reason=${status==='rejected'?(rejection_reason??null):null} WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const w = rows[0] as any;
    const _wd = w.date instanceof Date ? w.date.toISOString() : String(w.date);
    const dateStr = _wd.includes('T') ? new Date(new Date(_wd).getTime()+IST_MS).toISOString().slice(0,10) : _wd.slice(0,10);
    const wfhStatus = w.type === 'half_day' ? 'wfh_half' : 'wfh';
    if (status === 'approved') {
      await sql`INSERT INTO attendance_records (employee_id,date,status,total_hours,source) VALUES (${w.employee_id},${dateStr},${wfhStatus},0,'wfh') ON CONFLICT (employee_id,date) DO UPDATE SET status=${wfhStatus},source='wfh'`.catch(()=>{});
      notifyEmployeeUser(w.employee_id,'wfh_approved','WFH Approved',`Your Work From Home request has been approved.`).catch(()=>{});
    } else {
      await sql`DELETE FROM attendance_records WHERE employee_id=${w.employee_id} AND date::date=${dateStr}::date AND source='wfh'`.catch(()=>{});
      notifyEmployeeUser(w.employee_id,'wfh_rejected','WFH Request Rejected',`Your Work From Home request was rejected by HR.`).catch(()=>{});
    }
    res.json(w);
  } catch { res.status(500).json({ error: 'Server error' }); }
});
app.patch('/api/wfh/requests/:id/cancel', async (req, res) => {
  try {
    const { cancelled_by, cancellation_reason } = req.body;
    const rows = await sql`UPDATE wfh_requests SET status='cancelled',cancelled_by=${cancelled_by??null},cancelled_at=NOW(),cancellation_reason=${cancellation_reason??null} WHERE id=${req.params.id} AND status IN ('pending','approved') RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found or not cancellable' });
    const w = rows[0] as any;
    const _wd = w.date instanceof Date ? w.date.toISOString() : String(w.date);
    const dateStr = _wd.includes('T') ? new Date(new Date(_wd).getTime()+IST_MS).toISOString().slice(0,10) : _wd.slice(0,10);
    await sql`DELETE FROM attendance_records WHERE employee_id=${w.employee_id} AND date::date=${dateStr}::date AND source='wfh'`.catch(()=>{});
    res.json(w);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Users ─────────────────────────────────────────────────────────────────
app.get('/api/users', async (_req, res) => {
  try {
    res.json(await sql`SELECT id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at FROM app_users ORDER BY name`);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { employee_id_ref, name, email, password, role, department, designation, avatar } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'Required fields missing' });
    const existing = await sql`SELECT id FROM app_users WHERE LOWER(email)=LOWER(${email})`;
    if (existing.length) return res.status(409).json({ error: 'A user with this email already exists.' });
    const id = `u_${Date.now()}`;
    const av = avatar || name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
    const hashedPw = await bcrypt.hash(password, 10);
    const rows = await sql`
      INSERT INTO app_users (id, employee_id_ref, name, email, password, role, department, designation, avatar, active)
      VALUES (${id}, ${employee_id_ref ?? null}, ${name}, ${email}, ${hashedPw}, ${role}, ${department}, ${designation}, ${av}, true)
      RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, email, password, role, department, designation, avatar, active } = req.body;
    const pwToStore = password && !password.startsWith('$2') ? await bcrypt.hash(password, 10) : password;
    const rows = await sql`
      UPDATE app_users SET name=${name}, email=${email}, password=${pwToStore}, role=${role},
        department=${department}, designation=${designation}, avatar=${avatar}, active=${active}
      WHERE id=${req.params.id}
      RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/users/:id/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'current_password and new_password are required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    const userRows = await sql`SELECT password FROM app_users WHERE id=${req.params.id}`;
    if (!(userRows as any[]).length) return res.status(404).json({ error: 'User not found' });
    const storedPw = (userRows as any[])[0].password;
    const isHashed = typeof storedPw === 'string' && storedPw.startsWith('$2');
    const valid = isHashed ? await bcrypt.compare(current_password, storedPw) : storedPw === current_password;
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hashed = await bcrypt.hash(new_password, 10);
    await sql`UPDATE app_users SET password=${hashed} WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/users/:id/active', async (req, res) => {
  try {
    const { active } = req.body;
    const rows = await sql`UPDATE app_users SET active=${active} WHERE id=${req.params.id} RETURNING id, active`;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await sql`DELETE FROM app_users WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────
// Project Hours module — projects, monthly assignments, weekly logs
// ─────────────────────────────────────────────────────────────────────────

function newId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── Projects ─────────────────────────────────────────────────────────────
app.get('/api/projects', async (req, res) => {
  try {
    await runStartupMigrations();
    const { status, type } = req.query;
    let rows: any[];
    if (status && type) {
      rows = await sql`SELECT * FROM projects WHERE status=${status} AND project_type=${type} ORDER BY name ASC`;
    } else if (status) {
      rows = await sql`SELECT * FROM projects WHERE status=${status} ORDER BY name ASC`;
    } else if (type) {
      rows = await sql`SELECT * FROM projects WHERE project_type=${type} ORDER BY name ASC`;
    } else {
      rows = await sql`SELECT * FROM projects ORDER BY status='archived', name ASC`;
    }
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/projects', async (req, res) => {
  try {
    await runStartupMigrations();
    const {
      name, client_name, project_type, dashboard_url,
      project_reporting_id, project_reporting_name,
      project_lead_id, project_lead_name,
      status, flag, flag_reason, notes, created_by,
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = newId('proj');
    const rows = await sql`
      INSERT INTO projects (id, name, client_name, project_type, dashboard_url,
        project_reporting_id, project_reporting_name, project_lead_id, project_lead_name,
        status, flag, flag_reason, notes, created_by)
      VALUES (${id}, ${name}, ${client_name ?? null}, ${project_type ?? null}, ${dashboard_url ?? null},
        ${project_reporting_id ?? null}, ${project_reporting_name ?? null},
        ${project_lead_id ?? null}, ${project_lead_name ?? null},
        ${status ?? 'active'}, ${flag ?? null}, ${flag_reason ?? null}, ${notes ?? null}, ${created_by ?? null})
      RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const {
      name, client_name, project_type, dashboard_url,
      project_reporting_id, project_reporting_name,
      project_lead_id, project_lead_name,
      status, flag, flag_reason, notes,
    } = req.body;
    const rows = await sql`
      UPDATE projects SET
        name=${name}, client_name=${client_name ?? null}, project_type=${project_type ?? null},
        dashboard_url=${dashboard_url ?? null},
        project_reporting_id=${project_reporting_id ?? null}, project_reporting_name=${project_reporting_name ?? null},
        project_lead_id=${project_lead_id ?? null}, project_lead_name=${project_lead_name ?? null},
        status=${status ?? 'active'}, flag=${flag ?? null}, flag_reason=${flag_reason ?? null},
        notes=${notes ?? null}
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    // Soft delete: mark archived; preserves history of hour logs
    const rows = await sql`UPDATE projects SET status='archived' WHERE id=${req.params.id} RETURNING id, status`;
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Assignments ──────────────────────────────────────────────────────────
app.get('/api/project-assignments', async (req, res) => {
  try {
    await runStartupMigrations();
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;
    const employee_id = (req.query.employee_id as string) || null;
    const project_id = (req.query.project_id as string) || null;
    const rows = await sql`
      SELECT pa.*, p.name AS project_name, p.client_name AS project_client_name,
             p.project_type, p.dashboard_url, p.flag AS project_flag,
             p.project_reporting_id, p.project_reporting_name,
             p.project_lead_id, p.project_lead_name, p.status AS project_status
      FROM project_assignments pa
      JOIN projects p ON p.id = pa.project_id
      WHERE (${month}::int IS NULL OR pa.month=${month})
        AND (${year}::int IS NULL  OR pa.year=${year})
        AND (${employee_id}::text IS NULL OR pa.employee_id=${employee_id})
        AND (${project_id}::text IS NULL OR pa.project_id=${project_id})
      ORDER BY p.name ASC, pa.employee_name ASC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/project-assignments', async (req, res) => {
  try {
    await runStartupMigrations();
    const {
      project_id, employee_id, employee_name, month, year,
      w1_hours, w2_hours, w3_hours, w4_hours, w5_hours, notes, created_by,
    } = req.body;
    if (!project_id || !employee_id || !month || !year)
      return res.status(400).json({ error: 'project_id, employee_id, month, year are required' });
    const w1 = Number(w1_hours) || 0;
    const w2 = Number(w2_hours) || 0;
    const w3 = Number(w3_hours) || 0;
    const w4 = Number(w4_hours) || 0;
    const w5 = Number(w5_hours) || 0;
    const monthly = w1 + w2 + w3 + w4 + w5;
    const id = newId('pa');
    const rows = await sql`
      INSERT INTO project_assignments (id, project_id, employee_id, employee_name,
        month, year, monthly_hours, w1_hours, w2_hours, w3_hours, w4_hours, w5_hours,
        notes, created_by)
      VALUES (${id}, ${project_id}, ${employee_id}, ${employee_name ?? null},
        ${month}, ${year}, ${monthly}, ${w1}, ${w2}, ${w3}, ${w4}, ${w5},
        ${notes ?? null}, ${created_by ?? null})
      ON CONFLICT (project_id, employee_id, month, year) DO UPDATE SET
        w1_hours=EXCLUDED.w1_hours, w2_hours=EXCLUDED.w2_hours, w3_hours=EXCLUDED.w3_hours,
        w4_hours=EXCLUDED.w4_hours, w5_hours=EXCLUDED.w5_hours,
        monthly_hours=EXCLUDED.monthly_hours, notes=EXCLUDED.notes,
        updated_at=NOW()
      RETURNING *`;
    const inserted = rows[0];
    try {
      const proj = await sql`SELECT name FROM projects WHERE id=${project_id}`;
      const projectName = (proj as any[])[0]?.name || 'a project';
      notifyEmployeeUser(employee_id, 'hours_assigned',
        'Project Hours Assigned',
        `${monthly}h on ${projectName} for ${month}/${year}`).catch(()=>{});
    } catch {}
    res.status(201).json(inserted);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/project-assignments/:id', async (req, res) => {
  try {
    const { w1_hours, w2_hours, w3_hours, w4_hours, w5_hours, notes } = req.body;
    const w1 = Number(w1_hours) || 0;
    const w2 = Number(w2_hours) || 0;
    const w3 = Number(w3_hours) || 0;
    const w4 = Number(w4_hours) || 0;
    const w5 = Number(w5_hours) || 0;
    const monthly = w1 + w2 + w3 + w4 + w5;
    const rows = await sql`
      UPDATE project_assignments SET
        w1_hours=${w1}, w2_hours=${w2}, w3_hours=${w3}, w4_hours=${w4}, w5_hours=${w5},
        monthly_hours=${monthly}, notes=${notes ?? null}, updated_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
    const r = rows[0];
    try {
      const proj = await sql`SELECT name FROM projects WHERE id=${r.project_id}`;
      const projectName = (proj as any[])[0]?.name || 'a project';
      notifyEmployeeUser(r.employee_id, 'hours_updated',
        'Project Hours Updated',
        `${projectName} for ${r.month}/${r.year}: now ${monthly}h total`).catch(()=>{});
    } catch {}
    res.json(r);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/project-assignments/:id', async (req, res) => {
  try {
    const rows = await sql`DELETE FROM project_assignments WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
    const r = rows[0];
    try {
      const proj = await sql`SELECT name FROM projects WHERE id=${r.project_id}`;
      const projectName = (proj as any[])[0]?.name || 'a project';
      notifyEmployeeUser(r.employee_id, 'hours_removed',
        'Project Hours Removed',
        `${projectName} for ${r.month}/${r.year} was unassigned`).catch(()=>{});
    } catch {}
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/project-assignments/copy-month', async (req, res) => {
  try {
    const { from_month, from_year, to_month, to_year, created_by, blank_hours } = req.body;
    if (!from_month || !from_year || !to_month || !to_year)
      return res.status(400).json({ error: 'from_month, from_year, to_month, to_year are required' });
    const src = await sql`SELECT * FROM project_assignments WHERE month=${from_month} AND year=${from_year}`;
    let copied = 0;
    for (const s of src as any[]) {
      const id = newId('pa');
      const w1 = blank_hours ? 0 : Number(s.w1_hours) || 0;
      const w2 = blank_hours ? 0 : Number(s.w2_hours) || 0;
      const w3 = blank_hours ? 0 : Number(s.w3_hours) || 0;
      const w4 = blank_hours ? 0 : Number(s.w4_hours) || 0;
      const w5 = blank_hours ? 0 : Number(s.w5_hours) || 0;
      const monthly = w1 + w2 + w3 + w4 + w5;
      try {
        await sql`
          INSERT INTO project_assignments (id, project_id, employee_id, employee_name,
            month, year, monthly_hours, w1_hours, w2_hours, w3_hours, w4_hours, w5_hours,
            notes, created_by)
          VALUES (${id}, ${s.project_id}, ${s.employee_id}, ${s.employee_name},
            ${to_month}, ${to_year}, ${monthly}, ${w1}, ${w2}, ${w3}, ${w4}, ${w5},
            ${s.notes}, ${created_by ?? null})
          ON CONFLICT (project_id, employee_id, month, year) DO NOTHING`;
        copied++;
      } catch {}
    }
    res.json({ success: true, copied });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Hour logs ────────────────────────────────────────────────────────────
app.get('/api/hour-logs', async (req, res) => {
  try {
    await runStartupMigrations();
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;
    const employee_id = (req.query.employee_id as string) || null;
    const status = (req.query.status as string) || null;
    const reviewer_id = (req.query.reviewer_id as string) || null;
    const rows = await sql`
      SELECT hl.*, p.name AS project_name, p.client_name AS project_client_name,
             p.project_reporting_id, p.project_reporting_name,
             pa.w1_hours, pa.w2_hours, pa.w3_hours, pa.w4_hours, pa.w5_hours,
             pa.monthly_hours AS assignment_monthly_hours,
             COALESCE(au.admin_edit_count, 0) AS admin_edit_count,
             au.last_admin_edit_at,
             au.last_admin_editor
      FROM hour_logs hl
      JOIN projects p ON p.id = hl.project_id
      LEFT JOIN project_assignments pa ON pa.id = hl.assignment_id
      LEFT JOIN (
        SELECT hour_log_id,
          COUNT(*) FILTER (WHERE action='admin_edit') AS admin_edit_count,
          MAX(created_at) FILTER (WHERE action='admin_edit') AS last_admin_edit_at,
          (ARRAY_AGG(actor_name ORDER BY created_at DESC) FILTER (WHERE action='admin_edit'))[1] AS last_admin_editor
        FROM hour_log_audit
        GROUP BY hour_log_id
      ) au ON au.hour_log_id = hl.id
      WHERE (${month}::int IS NULL OR hl.month=${month})
        AND (${year}::int IS NULL  OR hl.year=${year})
        AND (${employee_id}::text IS NULL OR hl.employee_id=${employee_id})
        AND (${status}::text IS NULL OR hl.status=${status})
        AND (${reviewer_id}::text IS NULL OR p.project_reporting_id=${reviewer_id})
      ORDER BY hl.submitted_at DESC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/hour-logs', async (req, res) => {
  try {
    await runStartupMigrations();
    const { project_id, employee_id, employee_name, month, year, week_num, hours_logged, work_description } = req.body;
    if (!project_id || !employee_id || !month || !year || !week_num)
      return res.status(400).json({ error: 'project_id, employee_id, month, year, week_num are required' });
    const aRows = await sql`
      SELECT id FROM project_assignments
      WHERE project_id=${project_id} AND employee_id=${employee_id}
        AND month=${month} AND year=${year}`;
    if (!(aRows as any[]).length)
      return res.status(400).json({ error: 'No matching assignment exists for that project/month' });
    const assignment_id = (aRows as any[])[0].id;
    // Capture the pre-state so we can decide audit action: 'created' vs 'resubmitted'
    const preRows = await sql`SELECT id, hours_logged, status, work_description FROM hour_logs WHERE assignment_id=${assignment_id} AND week_num=${week_num}`;
    const existing = (preRows as any[])[0];
    const id = existing?.id ?? newId('hl');
    const rows = await sql`
      INSERT INTO hour_logs (id, assignment_id, project_id, employee_id, employee_name,
        month, year, week_num, hours_logged, work_description, status)
      VALUES (${id}, ${assignment_id}, ${project_id}, ${employee_id}, ${employee_name ?? null},
        ${month}, ${year}, ${week_num}, ${Number(hours_logged) || 0}, ${work_description ?? null}, 'pending')
      ON CONFLICT (assignment_id, week_num) DO UPDATE SET
        hours_logged=EXCLUDED.hours_logged,
        work_description=EXCLUDED.work_description,
        status='pending',
        rejection_reason=NULL,
        reviewed_by_id=NULL, reviewed_by_name=NULL, reviewed_at=NULL,
        submitted_at=NOW(), updated_at=NOW()
      RETURNING *`;
    const log = (rows as any[])[0];
    // Audit
    await recordHourLogAudit({
      hour_log_id: log.id,
      action: existing ? 'resubmitted' : 'created',
      actor_id: employee_id,
      actor_name: employee_name ?? null,
      actor_role: 'employee',
      before: existing ? { hours_logged: existing.hours_logged, status: existing.status, work_description: existing.work_description } : null,
      after: { hours_logged: Number(hours_logged) || 0, status: 'pending', work_description: work_description ?? null },
    });
    try {
      const p = await sql`SELECT name, project_reporting_id FROM projects WHERE id=${project_id}`;
      const projRow = (p as any[])[0];
      if (projRow?.project_reporting_id) {
        notifyEmployeeUser(projRow.project_reporting_id, 'hours_logged',
          'Hours Submitted for Review',
          `${req.body.employee_name || 'An employee'} logged ${hours_logged}h on ${projRow.name} (W${week_num})`).catch(()=>{});
      } else {
        notifyCoordinators('hours_logged',
          'Hours Submitted (no reviewer set)',
          `${req.body.employee_name || 'An employee'} logged ${hours_logged}h on ${projRow?.name || 'a project'} (W${week_num})`).catch(()=>{});
      }
    } catch {}
    res.status(201).json(log);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/hour-logs/:id', async (req, res) => {
  try {
    const { hours_logged, work_description, actor_id, actor_name, actor_role, keep_status, reason } = req.body;
    const existing = await sql`SELECT * FROM hour_logs WHERE id=${req.params.id}`;
    if (!(existing as any[]).length) return res.status(404).json({ error: 'Log not found' });
    const cur = (existing as any[])[0];
    const isPrivileged = actor_role === 'admin' || actor_role === 'hr_manager' || actor_role === 'project_coordinator';
    // Only privileged actors can touch an already-approved log
    if (cur.status === 'approved' && !isPrivileged) {
      return res.status(400).json({ error: 'Approved logs cannot be edited' });
    }
    // A privileged edit on an approved log MUST come with a reason — transparency for the audit trail.
    if (isPrivileged && cur.status === 'approved' && (!reason || !String(reason).trim())) {
      return res.status(400).json({ error: 'A reason is required when editing an already-approved log.' });
    }
    // Privileged + keep_status preserves the existing status (admin override on an approved log).
    // Default behaviour for an employee self-edit: reset to pending so it goes back through review.
    const preserve = isPrivileged && keep_status;
    const newHours = Number(hours_logged) || 0;
    const newDesc = work_description ?? null;
    const rows = preserve
      ? await sql`
        UPDATE hour_logs SET
          hours_logged=${newHours},
          work_description=${newDesc},
          updated_at=NOW()
        WHERE id=${req.params.id} RETURNING *`
      : await sql`
        UPDATE hour_logs SET
          hours_logged=${newHours},
          work_description=${newDesc},
          status='pending',
          rejection_reason=NULL,
          reviewed_by_id=NULL, reviewed_by_name=NULL, reviewed_at=NULL,
          updated_at=NOW()
        WHERE id=${req.params.id} RETURNING *`;
    const updated = (rows as any[])[0];
    // Audit — 'admin_edit' is reserved for a privileged actor overriding an
    // already-approved log. Any edit on a pending/rejected log is just 'edited'
    // (the actor's role still appears in the audit entry's actor_role badge).
    const auditAction: 'admin_edit' | 'edited' =
      isPrivileged && cur.status === 'approved' ? 'admin_edit' : 'edited';
    await recordHourLogAudit({
      hour_log_id: updated.id,
      action: auditAction,
      actor_id: actor_id ?? null,
      actor_name: actor_name ?? null,
      actor_role: actor_role ?? 'employee',
      before: { hours_logged: cur.hours_logged, status: cur.status, work_description: cur.work_description },
      after: { hours_logged: updated.hours_logged, status: updated.status, work_description: updated.work_description },
      reason: reason ?? null,
    });
    // If an admin / HR / coord changed an already-approved log, the employee deserves a heads-up.
    if (isPrivileged && cur.status === 'approved') {
      try {
        const proj = await sql`SELECT name FROM projects WHERE id=${updated.project_id}`;
        const projectName = (proj as any[])[0]?.name || 'a project';
        notifyEmployeeUser(updated.employee_id, 'hours_admin_edited',
          'Hours record edited',
          `${actor_name || 'An admin'} adjusted your ${cur.hours_logged}h → ${updated.hours_logged}h on ${projectName} (W${updated.week_num})${reason ? ` — ${reason}` : ''}`).catch(()=>{});
      } catch {}
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Audit history for one log — used by the detail modal's expandable History section
// ── Daily hour-log entries ────────────────────────────────────────────────
// Each row is one day for one assignment. Weekly hour_logs row is the rollup
// that gets reviewed/approved — kept in sync by recomputeWeeklyFromDays.
function weekNumOfDate(iso: string): number {
  // CEIL(day_of_month / 7) — gives 1..5
  const d = new Date(iso + 'T12:00:00Z');
  return Math.ceil(d.getUTCDate() / 7);
}

async function recomputeWeeklyFromDays(assignment_id: string, week_num: number): Promise<string | null> {
  const sumRows = await sql`
    SELECT COALESCE(SUM(hours), 0)::numeric AS total,
           COUNT(*)::int AS day_count,
           MIN(month) AS month, MIN(year) AS year,
           MIN(employee_id) AS employee_id,
           MIN(employee_name) AS employee_name,
           MIN(project_id) AS project_id
    FROM hour_log_days
    WHERE assignment_id=${assignment_id} AND week_num=${week_num}`;
  const r = (sumRows as any[])[0];
  const existing = await sql`SELECT id, status FROM hour_logs WHERE assignment_id=${assignment_id} AND week_num=${week_num}`;
  const e = (existing as any[])[0];
  if (!r || Number(r.day_count) === 0) {
    // No days remain for this week. DON'T auto-delete the parent — it may be a
    // legacy weekly entry the employee never converted to days. The week-level
    // DELETE endpoint is the explicit way to drop it. We just return whatever
    // parent id existed (or null if none).
    return e?.id ?? null;
  }
  if (e) {
    await sql`
      UPDATE hour_logs SET
        hours_logged=${Number(r.total)},
        status='pending',
        rejection_reason=NULL,
        reviewed_by_id=NULL, reviewed_by_name=NULL, reviewed_at=NULL,
        submitted_at=NOW(), updated_at=NOW()
      WHERE id=${e.id}`;
    // Backfill day pointers so /api/hour-log-days returns the parent id consistently
    await sql`UPDATE hour_log_days SET hour_log_id=${e.id}
              WHERE assignment_id=${assignment_id} AND week_num=${week_num} AND hour_log_id IS NULL`;
    return e.id;
  }
  const id = newId('hl');
  await sql`
    INSERT INTO hour_logs (id, assignment_id, project_id, employee_id, employee_name,
      month, year, week_num, hours_logged, work_description, status)
    VALUES (${id}, ${assignment_id}, ${r.project_id}, ${r.employee_id}, ${r.employee_name},
      ${r.month}, ${r.year}, ${week_num}, ${Number(r.total)}, NULL, 'pending')`;
  await sql`UPDATE hour_log_days SET hour_log_id=${id}
            WHERE assignment_id=${assignment_id} AND week_num=${week_num} AND hour_log_id IS NULL`;
  return id;
}

app.get('/api/hour-log-days', async (req, res) => {
  try {
    await runStartupMigrations();
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;
    const employee_id = (req.query.employee_id as string) || null;
    const assignment_id = (req.query.assignment_id as string) || null;
    const rows = await sql`
      SELECT d.*, p.name AS project_name, p.client_name AS project_client_name
      FROM hour_log_days d
      JOIN projects p ON p.id = d.project_id
      WHERE (${month}::int IS NULL OR d.month=${month})
        AND (${year}::int  IS NULL OR d.year=${year})
        AND (${employee_id}::text IS NULL OR d.employee_id=${employee_id})
        AND (${assignment_id}::text IS NULL OR d.assignment_id=${assignment_id})
      ORDER BY d.log_date ASC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/hour-log-days', async (req, res) => {
  try {
    await runStartupMigrations();
    const { assignment_id, log_date, hours, notes, employee_id, employee_name } = req.body;
    if (!assignment_id || !log_date || hours === undefined || hours === null)
      return res.status(400).json({ error: 'assignment_id, log_date and hours are required' });
    const aRows = await sql`SELECT project_id, employee_id, month, year FROM project_assignments WHERE id=${assignment_id}`;
    if (!(aRows as any[]).length) return res.status(404).json({ error: 'Assignment not found' });
    const a = (aRows as any[])[0];
    // Make sure log_date falls within the assignment's month/year
    const dParts = String(log_date).slice(0, 10).split('-').map(Number);
    if (dParts[0] !== a.year || dParts[1] !== a.month) {
      return res.status(400).json({ error: `log_date must be in ${a.year}-${String(a.month).padStart(2,'0')}` });
    }
    const week_num = weekNumOfDate(log_date);
    const id = newId('hld');
    const hoursN = Number(hours) || 0;
    await sql`
      INSERT INTO hour_log_days (id, assignment_id, project_id, employee_id, employee_name,
        log_date, week_num, month, year, hours, notes)
      VALUES (${id}, ${assignment_id}, ${a.project_id}, ${employee_id ?? a.employee_id}, ${employee_name ?? null},
        ${log_date}, ${week_num}, ${a.month}, ${a.year}, ${hoursN}, ${notes ?? null})
      ON CONFLICT (assignment_id, log_date) DO UPDATE SET
        hours=EXCLUDED.hours, notes=EXCLUDED.notes, updated_at=NOW()`;
    const parentId = await recomputeWeeklyFromDays(assignment_id, week_num);
    res.status(201).json({ assignment_id, log_date, week_num, hours: hoursN, hour_log_id: parentId });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/hour-log-days/:id', async (req, res) => {
  try {
    const { hours, notes } = req.body;
    const existing = await sql`SELECT * FROM hour_log_days WHERE id=${req.params.id}`;
    if (!(existing as any[]).length) return res.status(404).json({ error: 'Day entry not found' });
    const cur = (existing as any[])[0];
    await sql`
      UPDATE hour_log_days SET
        hours=${Number(hours) || 0},
        notes=${notes ?? null},
        updated_at=NOW()
      WHERE id=${req.params.id}`;
    const parentId = await recomputeWeeklyFromDays(cur.assignment_id, cur.week_num);
    res.json({ id: cur.id, assignment_id: cur.assignment_id, week_num: cur.week_num, hour_log_id: parentId });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/hour-log-days/:id', async (req, res) => {
  try {
    const existing = await sql`SELECT assignment_id, week_num FROM hour_log_days WHERE id=${req.params.id}`;
    if (!(existing as any[]).length) return res.status(404).json({ error: 'Day entry not found' });
    const cur = (existing as any[])[0];
    await sql`DELETE FROM hour_log_days WHERE id=${req.params.id}`;
    const parentId = await recomputeWeeklyFromDays(cur.assignment_id, cur.week_num);
    res.json({ success: true, hour_log_id: parentId });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.get('/api/hour-logs/:id/audit', async (req, res) => {
  try {
    await runStartupMigrations();
    const rows = await sql`
      SELECT * FROM hour_log_audit
      WHERE hour_log_id=${req.params.id}
      ORDER BY created_at ASC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Delete an hour log. Employees can only delete their own pending or rejected log.
// Admin / HR / Coord can delete any log; if it was already approved, a `reason` is required.
// The audit trail is preserved (entries stay in hour_log_audit referencing the gone log_id),
// and we add one final 'deleted' entry too.
app.delete('/api/hour-logs/:id', async (req, res) => {
  try {
    await runStartupMigrations();
    const { actor_id, actor_name, actor_role, reason } = req.body ?? {};
    const existing = await sql`SELECT * FROM hour_logs WHERE id=${req.params.id}`;
    if (!(existing as any[]).length) return res.status(404).json({ error: 'Log not found' });
    const cur = (existing as any[])[0];
    const isPrivileged = actor_role === 'admin' || actor_role === 'hr_manager' || actor_role === 'project_coordinator';
    if (!isPrivileged) {
      // Employees can only delete their OWN log AND only if it's not approved
      if (cur.employee_id !== actor_id) {
        return res.status(403).json({ error: 'You can only delete your own logs.' });
      }
      if (cur.status === 'approved') {
        return res.status(400).json({ error: 'Approved logs cannot be deleted. Contact your coordinator.' });
      }
    } else if (cur.status === 'approved' && (!reason || !String(reason).trim())) {
      return res.status(400).json({ error: 'A reason is required when deleting an approved log.' });
    }

    // Record audit BEFORE the row goes away — the audit table doesn't cascade.
    await recordHourLogAudit({
      hour_log_id: cur.id,
      action: 'deleted',
      actor_id: actor_id ?? null,
      actor_name: actor_name ?? null,
      actor_role: actor_role ?? 'employee',
      before: { hours_logged: cur.hours_logged, status: cur.status, work_description: cur.work_description },
      after: null,
      reason: reason ?? null,
    });
    await sql`DELETE FROM hour_logs WHERE id=${req.params.id}`;
    // Notify the employee if someone else deleted their (approved) log
    if (isPrivileged && cur.status === 'approved' && cur.employee_id !== actor_id) {
      try {
        const proj = await sql`SELECT name FROM projects WHERE id=${cur.project_id}`;
        const projectName = (proj as any[])[0]?.name || 'a project';
        notifyEmployeeUser(cur.employee_id, 'hours_admin_edited',
          'Hours record deleted',
          `${actor_name || 'An admin'} deleted your ${cur.hours_logged}h on ${projectName} (W${cur.week_num})${reason ? ` — ${reason}` : ''}`).catch(()=>{});
      } catch {}
    }
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.patch('/api/hour-logs/:id/approve', async (req, res) => {
  try {
    const { reviewer_id, reviewer_name } = req.body;
    const pre = await sql`SELECT hours_logged, status, work_description FROM hour_logs WHERE id=${req.params.id}`;
    const cur = (pre as any[])[0];
    const rows = await sql`
      UPDATE hour_logs SET status='approved',
        rejection_reason=NULL,
        reviewed_by_id=${reviewer_id ?? null}, reviewed_by_name=${reviewer_name ?? null},
        reviewed_at=NOW(), updated_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Log not found' });
    const r = rows[0];
    await recordHourLogAudit({
      hour_log_id: r.id,
      action: 'approved',
      actor_id: reviewer_id ?? null,
      actor_name: reviewer_name ?? null,
      actor_role: 'reviewer',
      before: cur ? { hours_logged: cur.hours_logged, status: cur.status, work_description: cur.work_description } : null,
      after: { hours_logged: r.hours_logged, status: r.status, work_description: r.work_description },
    });
    try {
      const proj = await sql`SELECT name FROM projects WHERE id=${r.project_id}`;
      const projectName = (proj as any[])[0]?.name || 'a project';
      notifyEmployeeUser(r.employee_id, 'hours_approved',
        'Hours Approved',
        `Your ${r.hours_logged}h on ${projectName} (W${r.week_num}) was approved by ${reviewer_name || 'reviewer'}`).catch(()=>{});
    } catch {}
    res.json(r);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.patch('/api/hour-logs/:id/reject', async (req, res) => {
  try {
    const { reviewer_id, reviewer_name, rejection_reason } = req.body;
    if (!rejection_reason) return res.status(400).json({ error: 'rejection_reason is required' });
    const pre = await sql`SELECT hours_logged, status, work_description FROM hour_logs WHERE id=${req.params.id}`;
    const cur = (pre as any[])[0];
    const rows = await sql`
      UPDATE hour_logs SET status='rejected',
        rejection_reason=${rejection_reason},
        reviewed_by_id=${reviewer_id ?? null}, reviewed_by_name=${reviewer_name ?? null},
        reviewed_at=NOW(), updated_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Log not found' });
    const r = rows[0];
    await recordHourLogAudit({
      hour_log_id: r.id,
      action: 'rejected',
      actor_id: reviewer_id ?? null,
      actor_name: reviewer_name ?? null,
      actor_role: 'reviewer',
      before: cur ? { hours_logged: cur.hours_logged, status: cur.status, work_description: cur.work_description } : null,
      after: { hours_logged: r.hours_logged, status: r.status, work_description: r.work_description },
      reason: rejection_reason,
    });
    try {
      const proj = await sql`SELECT name FROM projects WHERE id=${r.project_id}`;
      const projectName = (proj as any[])[0]?.name || 'a project';
      notifyEmployeeUser(r.employee_id, 'hours_rejected',
        'Hours Rejected',
        `Your ${r.hours_logged}h on ${projectName} (W${r.week_num}) was rejected: ${rejection_reason}`).catch(()=>{});
    } catch {}
    res.json(r);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Aggregation: per-employee weekly totals + variance vs 35h target ─────
app.get('/api/hours-summary', async (req, res) => {
  try {
    await runStartupMigrations();
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    const byEmployee = await sql`
      SELECT employee_id, COALESCE(MAX(employee_name),'') AS employee_name,
        SUM(COALESCE(w1_hours,0))::numeric AS w1,
        SUM(COALESCE(w2_hours,0))::numeric AS w2,
        SUM(COALESCE(w3_hours,0))::numeric AS w3,
        SUM(COALESCE(w4_hours,0))::numeric AS w4,
        SUM(COALESCE(w5_hours,0))::numeric AS w5,
        SUM(COALESCE(monthly_hours,0))::numeric AS monthly
      FROM project_assignments
      WHERE month=${month} AND year=${year}
      GROUP BY employee_id
      ORDER BY employee_name ASC`;
    // Per-employee log sums, with approved hours split into "within plan" and "over plan"
    // by joining to the assignment so we know the weekly allocation for that log's week.
    const logSums = await sql`
      SELECT hl.employee_id,
        SUM(CASE WHEN hl.status='approved' THEN hl.hours_logged ELSE 0 END)::numeric AS logged_approved,
        SUM(CASE WHEN hl.status='pending'  THEN hl.hours_logged ELSE 0 END)::numeric AS logged_pending,
        SUM(CASE WHEN hl.status='rejected' THEN hl.hours_logged ELSE 0 END)::numeric AS logged_rejected,
        SUM(CASE WHEN hl.status='approved' THEN
          LEAST(hl.hours_logged, COALESCE(
            CASE hl.week_num
              WHEN 1 THEN pa.w1_hours WHEN 2 THEN pa.w2_hours WHEN 3 THEN pa.w3_hours
              WHEN 4 THEN pa.w4_hours WHEN 5 THEN pa.w5_hours
            END, 0))
        ELSE 0 END)::numeric AS logged_within_plan,
        SUM(CASE WHEN hl.status='approved' THEN
          GREATEST(0, hl.hours_logged - COALESCE(
            CASE hl.week_num
              WHEN 1 THEN pa.w1_hours WHEN 2 THEN pa.w2_hours WHEN 3 THEN pa.w3_hours
              WHEN 4 THEN pa.w4_hours WHEN 5 THEN pa.w5_hours
            END, 0))
        ELSE 0 END)::numeric AS logged_over_plan,
        COUNT(*) FILTER (WHERE hl.status='approved' AND hl.hours_logged > COALESCE(
            CASE hl.week_num
              WHEN 1 THEN pa.w1_hours WHEN 2 THEN pa.w2_hours WHEN 3 THEN pa.w3_hours
              WHEN 4 THEN pa.w4_hours WHEN 5 THEN pa.w5_hours
            END, 0)) AS over_plan_log_count,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=1 THEN hl.hours_logged ELSE 0 END)::numeric AS w1_logged,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=2 THEN hl.hours_logged ELSE 0 END)::numeric AS w2_logged,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=3 THEN hl.hours_logged ELSE 0 END)::numeric AS w3_logged,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=4 THEN hl.hours_logged ELSE 0 END)::numeric AS w4_logged,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=5 THEN hl.hours_logged ELSE 0 END)::numeric AS w5_logged,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=1 THEN GREATEST(0, hl.hours_logged - COALESCE(pa.w1_hours, 0)) ELSE 0 END)::numeric AS w1_over,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=2 THEN GREATEST(0, hl.hours_logged - COALESCE(pa.w2_hours, 0)) ELSE 0 END)::numeric AS w2_over,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=3 THEN GREATEST(0, hl.hours_logged - COALESCE(pa.w3_hours, 0)) ELSE 0 END)::numeric AS w3_over,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=4 THEN GREATEST(0, hl.hours_logged - COALESCE(pa.w4_hours, 0)) ELSE 0 END)::numeric AS w4_over,
        SUM(CASE WHEN hl.status='approved' AND hl.week_num=5 THEN GREATEST(0, hl.hours_logged - COALESCE(pa.w5_hours, 0)) ELSE 0 END)::numeric AS w5_over
      FROM hour_logs hl
      LEFT JOIN project_assignments pa ON pa.id = hl.assignment_id
      WHERE hl.month=${month} AND hl.year=${year}
      GROUP BY hl.employee_id`;
    // Per-employee per-week admin-edit counts + most recent timestamp
    const editStats = await sql`
      SELECT hl.employee_id,
        SUM(CASE WHEN hl.week_num=1 AND au.action='admin_edit' THEN 1 ELSE 0 END)::int AS w1_edits,
        SUM(CASE WHEN hl.week_num=2 AND au.action='admin_edit' THEN 1 ELSE 0 END)::int AS w2_edits,
        SUM(CASE WHEN hl.week_num=3 AND au.action='admin_edit' THEN 1 ELSE 0 END)::int AS w3_edits,
        SUM(CASE WHEN hl.week_num=4 AND au.action='admin_edit' THEN 1 ELSE 0 END)::int AS w4_edits,
        SUM(CASE WHEN hl.week_num=5 AND au.action='admin_edit' THEN 1 ELSE 0 END)::int AS w5_edits,
        MAX(CASE WHEN hl.week_num=1 AND au.action='admin_edit' THEN au.created_at END) AS w1_last_edit,
        MAX(CASE WHEN hl.week_num=2 AND au.action='admin_edit' THEN au.created_at END) AS w2_last_edit,
        MAX(CASE WHEN hl.week_num=3 AND au.action='admin_edit' THEN au.created_at END) AS w3_last_edit,
        MAX(CASE WHEN hl.week_num=4 AND au.action='admin_edit' THEN au.created_at END) AS w4_last_edit,
        MAX(CASE WHEN hl.week_num=5 AND au.action='admin_edit' THEN au.created_at END) AS w5_last_edit,
        SUM(CASE WHEN au.action='admin_edit' THEN 1 ELSE 0 END)::int AS total_admin_edits
      FROM hour_logs hl
      LEFT JOIN hour_log_audit au ON au.hour_log_id = hl.id
      WHERE hl.month=${month} AND hl.year=${year}
      GROUP BY hl.employee_id`;
    const editsMap = new Map<string, any>();
    for (const e of editStats as any[]) editsMap.set(e.employee_id, e);
    const logsMap = new Map<string, any>();
    for (const l of logSums as any[]) logsMap.set(l.employee_id, l);
    const totals = await sql`
      SELECT
        COALESCE(SUM(COALESCE(monthly_hours,0)),0)::numeric AS total_allocated
      FROM project_assignments WHERE month=${month} AND year=${year}`;
    const logTotals = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN hl.status='approved' THEN hl.hours_logged ELSE 0 END),0)::numeric AS total_approved,
        COALESCE(SUM(CASE WHEN hl.status='pending'  THEN hl.hours_logged ELSE 0 END),0)::numeric AS total_pending,
        COALESCE(SUM(CASE WHEN hl.status='approved' THEN
          LEAST(hl.hours_logged, COALESCE(
            CASE hl.week_num
              WHEN 1 THEN pa.w1_hours WHEN 2 THEN pa.w2_hours WHEN 3 THEN pa.w3_hours
              WHEN 4 THEN pa.w4_hours WHEN 5 THEN pa.w5_hours
            END, 0))
        ELSE 0 END),0)::numeric AS total_within_plan,
        COALESCE(SUM(CASE WHEN hl.status='approved' THEN
          GREATEST(0, hl.hours_logged - COALESCE(
            CASE hl.week_num
              WHEN 1 THEN pa.w1_hours WHEN 2 THEN pa.w2_hours WHEN 3 THEN pa.w3_hours
              WHEN 4 THEN pa.w4_hours WHEN 5 THEN pa.w5_hours
            END, 0))
        ELSE 0 END),0)::numeric AS total_over_plan,
        COUNT(*) FILTER (WHERE hl.status='pending') AS pending_count,
        COUNT(*) FILTER (WHERE hl.status='approved' AND hl.hours_logged > COALESCE(
            CASE hl.week_num
              WHEN 1 THEN pa.w1_hours WHEN 2 THEN pa.w2_hours WHEN 3 THEN pa.w3_hours
              WHEN 4 THEN pa.w4_hours WHEN 5 THEN pa.w5_hours
            END, 0)) AS over_plan_log_count
      FROM hour_logs hl
      LEFT JOIN project_assignments pa ON pa.id = hl.assignment_id
      WHERE hl.month=${month} AND hl.year=${year}`;
    const employeeRows = (byEmployee as any[]).map((e: any) => {
      const log = logsMap.get(e.employee_id) || {};
      const edits = editsMap.get(e.employee_id) || {};
      const weeks = [Number(e.w1), Number(e.w2), Number(e.w3), Number(e.w4), Number(e.w5)];
      const variance = weeks.map(w => w - 35);
      return {
        employee_id: e.employee_id,
        employee_name: e.employee_name,
        w1: Number(e.w1), w2: Number(e.w2), w3: Number(e.w3), w4: Number(e.w4), w5: Number(e.w5),
        monthly: Number(e.monthly),
        variance_w1: variance[0], variance_w2: variance[1],
        variance_w3: variance[2], variance_w4: variance[3], variance_w5: variance[4],
        logged_approved: Number(log.logged_approved ?? 0),
        logged_pending: Number(log.logged_pending ?? 0),
        logged_rejected: Number(log.logged_rejected ?? 0),
        logged_within_plan: Number(log.logged_within_plan ?? 0),
        logged_over_plan: Number(log.logged_over_plan ?? 0),
        over_plan_log_count: Number(log.over_plan_log_count ?? 0),
        w1_logged: Number(log.w1_logged ?? 0), w2_logged: Number(log.w2_logged ?? 0),
        w3_logged: Number(log.w3_logged ?? 0), w4_logged: Number(log.w4_logged ?? 0),
        w5_logged: Number(log.w5_logged ?? 0),
        w1_over: Number(log.w1_over ?? 0), w2_over: Number(log.w2_over ?? 0),
        w3_over: Number(log.w3_over ?? 0), w4_over: Number(log.w4_over ?? 0),
        w5_over: Number(log.w5_over ?? 0),
        w1_edits: Number(edits.w1_edits ?? 0), w2_edits: Number(edits.w2_edits ?? 0),
        w3_edits: Number(edits.w3_edits ?? 0), w4_edits: Number(edits.w4_edits ?? 0),
        w5_edits: Number(edits.w5_edits ?? 0),
        w1_last_edit: edits.w1_last_edit ?? null, w2_last_edit: edits.w2_last_edit ?? null,
        w3_last_edit: edits.w3_last_edit ?? null, w4_last_edit: edits.w4_last_edit ?? null,
        w5_last_edit: edits.w5_last_edit ?? null,
        total_admin_edits: Number(edits.total_admin_edits ?? 0),
      };
    });
    res.json({
      month, year,
      employees: employeeRows,
      total_allocated: Number((totals as any[])[0]?.total_allocated || 0),
      total_logged_approved: Number((logTotals as any[])[0]?.total_approved || 0),
      total_logged_pending: Number((logTotals as any[])[0]?.total_pending || 0),
      total_logged_within_plan: Number((logTotals as any[])[0]?.total_within_plan || 0),
      total_logged_over_plan: Number((logTotals as any[])[0]?.total_over_plan || 0),
      over_plan_log_count: Number((logTotals as any[])[0]?.over_plan_log_count || 0),
      pending_review_count: Number((logTotals as any[])[0]?.pending_count || 0),
    });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Global error handler — always return JSON, never Express HTML page ────
// This catches any error that slips past individual route try-catch blocks
// (e.g. CORS rejections, async errors in Express 5, middleware failures)
// and returns the actual error message so it's visible instead of opaque HTML.
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[Unhandled Express error]', err?.message ?? err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({ error: err?.message || 'Internal server error' });
});

export default app;

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

// Service log for a repair ticket / asset — captures every admin action so
// HR can audit what happened and when. NOT visible to the affected employee.
async function recordAssetActivity(p: {
  ticket_id?: string | null;
  asset_id?: string | null;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  description?: string | null;
  before_value?: string | null;
  after_value?: string | null;
}) {
  try {
    await sql`
      INSERT INTO asset_activity_log (
        ticket_id, asset_id, action, actor_id, actor_name, actor_role,
        description, before_value, after_value
      ) VALUES (
        ${p.ticket_id ?? null}, ${p.asset_id ?? null}, ${p.action},
        ${p.actor_id ?? null}, ${p.actor_name ?? null}, ${p.actor_role ?? null},
        ${p.description ?? null}, ${p.before_value ?? null}, ${p.after_value ?? null}
      )`;
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

// ── Admin guard for the Finance module ──────────────────────────────────
// The app's session lives client-side, so the finance API client sends the
// signed-in user's id in the `x-user-id` header. We verify here that the
// caller is an active admin before returning any financial data.
async function requireAdmin(req: any, res: any): Promise<boolean> {
  try {
    const userId = req.header('x-user-id') || req.query.__uid;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return false; }
    const rows = await sql`SELECT role, active FROM app_users WHERE id = ${userId} LIMIT 1`;
    const u = (rows as any[])[0];
    if (!u || u.active !== true || u.role !== 'admin') {
      res.status(403).json({ error: 'Admins only' });
      return false;
    }
    return true;
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Auth check failed' });
    return false;
  }
}

// Allow admin OR project_coordinator (used for project-level expense entries
// which a coordinator may add against the projects they run).
async function requireAdminOrCoord(req: any, res: any): Promise<{ ok: boolean; user?: any }> {
  try {
    const userId = req.header('x-user-id') || req.query.__uid;
    if (!userId) { res.status(401).json({ error: 'Not authenticated' }); return { ok: false }; }
    const rows = await sql`SELECT id, name, role, active FROM app_users WHERE id = ${userId} LIMIT 1`;
    const u = (rows as any[])[0];
    if (!u || u.active !== true || !['admin','project_coordinator','hr_manager'].includes(u.role)) {
      res.status(403).json({ error: 'Admin / HR / coordinator only' });
      return { ok: false };
    }
    return { ok: true, user: u };
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Auth check failed' });
    return { ok: false };
  }
}

// ── Startup migrations (idempotent — safe to run on every cold start) ────
let _migrated = false;
// Seed the project_coordinator playbook. Idempotent — only inserts when the
// role has zero rows, so admins can freely edit / delete items without them
// reappearing on every cold start.
async function seedRoleResponsibilities() {
  try {
    const existing = (await sql`SELECT COUNT(*)::int AS c FROM role_responsibilities WHERE role='project_coordinator'`) as any[];
    if (Number(existing[0]?.c || 0) > 0) return;

    type Item = { section: string; sOrd: number; iOrd: number; title: string; details?: string; freq?: string; where?: string };
    const items: Item[] = [
      // ── Section 1: Client onboarding ────────────────────────────────────────
      { section: 'Client onboarding', sOrd: 1, iOrd: 1, freq: 'one_time',
        title: 'Create the project',
        where: 'Project Mgmt → Projects → + New Project',
        details: 'Set name, client, type, dashboard URL, reporting person (the approver for hour logs on this project), project lead, and total-hours cap (only for one-time fixed-budget projects — leave blank for retainers).' },
      { section: 'Client onboarding', sOrd: 1, iOrd: 2, freq: 'one_time',
        title: 'Assign the team for the current month',
        where: 'Project Mgmt → Hours grid → Add Assignment',
        details: 'For every employee who will work on the project this month, allocate W1–W5 hours. Aim for 35h/week per person across all their projects. The Capacity tab flags anyone over/under.' },
      { section: 'Client onboarding', sOrd: 1, iOrd: 3, freq: 'one_time',
        title: 'Raise the first invoice',
        where: 'Finance → Invoices → + New Invoice',
        details: 'Pick the project, set invoice #, date, amount invoiced, and notes. Status starts as Pending until admin confirms the payment landed in the bank.' },
      { section: 'Client onboarding', sOrd: 1, iOrd: 4, freq: 'one_time',
        title: 'Notify the assigned team',
        details: 'Employees get an "hours_assigned" notification automatically, but a heads-up in your usual channel (WhatsApp / Slack) lands the context.' },

      // ── Section 2: Daily ────────────────────────────────────────────────────
      { section: 'Daily routine', sOrd: 2, iOrd: 1, freq: 'daily',
        title: 'Check who hasn\'t logged hours today',
        where: 'Project Mgmt → Compliance',
        details: 'Page lists every eligible employee with zero logs for the day. Follow up with the gaps before end of shift.' },
      { section: 'Daily routine', sOrd: 2, iOrd: 2, freq: 'daily',
        title: 'Approve hour logs on projects you review',
        where: 'Project Mgmt → Approvals',
        details: 'You only see logs for projects where you\'re the Reporting person. Don\'t sit on them — anything older than 24h is flagged on Compliance.' },
      { section: 'Daily routine', sOrd: 2, iOrd: 3, freq: 'daily',
        title: 'Watch the bell for alerts',
        where: 'Top-right bell icon · also /notifications',
        details: 'Pending invoices, rejected logs, project alerts all surface there. Click View all to see full history.' },

      // ── Section 3: Weekly ───────────────────────────────────────────────────
      { section: 'Weekly review (Mon morning ~15min)', sOrd: 3, iOrd: 1, freq: 'weekly',
        title: 'Review last week\'s actuals vs plan',
        where: 'Hours grid → Capacity tab → Group: Team',
        details: 'Spot people consistently over or under. Talk to them or rebalance allocations.' },
      { section: 'Weekly review (Mon morning ~15min)', sOrd: 3, iOrd: 2, freq: 'weekly',
        title: 'Log outsourced expenses from last week',
        where: 'Projects → ₹ icon on each project',
        details: 'Freelancer fees, content fees, ad spend, tools — anything outsourced for delivery goes here so it shows up correctly in project profitability.' },
      { section: 'Weekly review (Mon morning ~15min)', sOrd: 3, iOrd: 3, freq: 'weekly',
        title: 'Update project flags',
        where: 'Projects (main table)',
        details: 'If a project slipped last week, set its flag to Yellow with a short reason. Red means at-risk and needs immediate attention.' },

      // ── Section 4: Monthly ──────────────────────────────────────────────────
      { section: 'Month-end (25th–28th)', sOrd: 4, iOrd: 1, freq: 'monthly',
        title: 'Copy this month\'s assignments to next month',
        where: 'Hours grid → Copy from previous month',
        details: 'Duplicates every row in bulk; hours come over blank so you can refill them deliberately.' },
      { section: 'Month-end (25th–28th)', sOrd: 4, iOrd: 2, freq: 'monthly',
        title: 'Refill W1–W5 hours for next month',
        where: 'Hours grid → Plan tab',
        details: 'Inline-edit each cell. M (monthly total) auto-recalculates.' },
      { section: 'First week of new month', sOrd: 5, iOrd: 1, freq: 'monthly',
        title: 'Raise this month\'s invoice for every active project',
        where: 'Finance → Invoices → + New Invoice',
        details: 'Status = Pending. Admin marks Cleared once payment lands and updates the received amount (which becomes the actual revenue).' },

      // ── Section 5: As-needed ────────────────────────────────────────────────
      { section: 'Ad-hoc actions', sOrd: 6, iOrd: 1, freq: 'as_needed',
        title: 'Adding someone to a project mid-month',
        where: 'Hours grid → Add Assignment',
        details: 'Allocate hours only for the remaining weeks of the month.' },
      { section: 'Ad-hoc actions', sOrd: 6, iOrd: 2, freq: 'as_needed',
        title: 'Removing someone from a project',
        where: 'Hours grid → Plan tab → trash icon',
        details: 'Future plans for that employee on that project are dropped. Already-logged hours stay for history.' },
      { section: 'Ad-hoc actions', sOrd: 6, iOrd: 3, freq: 'as_needed',
        title: 'Project at risk',
        where: 'Projects → edit the row',
        details: 'Flag Red with a reason. Don\'t wait — admin can see the flag immediately and intervene.' },
      { section: 'Ad-hoc actions', sOrd: 6, iOrd: 4, freq: 'as_needed',
        title: 'Outsourced work (freelancer / content / ads / tools)',
        where: 'Projects → ₹ icon → New expense',
        details: 'Log against the right project. Category options: outsource / content / ads / tools / travel / other.' },
      { section: 'Ad-hoc actions', sOrd: 6, iOrd: 5, freq: 'as_needed',
        title: 'Project finished or churned',
        where: 'Projects → trash icon (soft-delete to archived)',
        details: 'Auto-clears current and future-month assignments. Past months and hour logs are preserved for reporting.' },
      { section: 'Ad-hoc actions', sOrd: 6, iOrd: 6, freq: 'as_needed',
        title: 'Hour log rejected by reviewer',
        where: 'Notifications → click the row',
        details: 'Read the reason, re-plan or talk to the employee, and ask them to resubmit.' },
      { section: 'Ad-hoc actions', sOrd: 6, iOrd: 7, freq: 'as_needed',
        title: 'Client paid less than invoiced (TDS, FX, partial)',
        details: 'Tell admin so they clear the invoice with the actual received amount. The variance becomes a real cost in P&L.' },
    ];

    for (const it of items) {
      await sql`
        INSERT INTO role_responsibilities (role, section_name, section_order, item_order, title, details, frequency, where_to_do)
        VALUES ('project_coordinator', ${it.section}, ${it.sOrd}, ${it.iOrd}, ${it.title}, ${it.details ?? null}, ${it.freq ?? null}, ${it.where ?? null})`;
    }
  } catch { /* migrations are best-effort */ }
}

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
  // Multi-currency on the deal value. Approved/paid amount stays in INR
  // (it's what HR actually disburses).
  try {
    await sql`ALTER TABLE upsell_requests ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR'`;
    await sql`ALTER TABLE upsell_requests ADD COLUMN IF NOT EXISTS fx_rate NUMERIC`;
    await sql`ALTER TABLE upsell_requests ADD COLUMN IF NOT EXISTS deal_value_inr NUMERIC`;
    await sql`
      UPDATE upsell_requests
      SET currency=COALESCE(currency, 'INR'),
          fx_rate=COALESCE(fx_rate, 1),
          deal_value_inr=COALESCE(deal_value_inr, deal_value)
      WHERE currency IS NULL OR deal_value_inr IS NULL`;
  } catch { /* idempotent */ }
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
  // Asset categories — admin/HR can add new categories (mouse, keyboard,
  // monitor, etc.) so assets aren't restricted to laptops. Seeded with a
  // sensible default set the first time the table is created.
  await sql`
    CREATE TABLE IF NOT EXISTS asset_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS category_id TEXT`.catch(()=>{});
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
    CREATE TABLE IF NOT EXISTS holidays (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'public',
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date)`.catch(()=>{});
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
    CREATE TABLE IF NOT EXISTS asset_activity_log (
      id SERIAL PRIMARY KEY,
      asset_id TEXT,
      ticket_id TEXT,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      actor_role TEXT,
      description TEXT,
      before_value TEXT,
      after_value TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_asset_log_ticket ON asset_activity_log(ticket_id)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_asset_log_asset  ON asset_activity_log(asset_id)`.catch(()=>{});

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

  // ── Finance / CFO module (admin-only) ───────────────────────────────────
  // Reuses employees.salary, projects, and project_assignments.monthly_hours.
  // These tables only add the finance-specific layer: revenue, direct/indirect
  // classification, overhead costs and settings.
  await sql`
    CREATE TABLE IF NOT EXISTS fin_settings (
      id INTEGER PRIMARY KEY,
      working_hours_per_month NUMERIC NOT NULL DEFAULT 176,
      overhead_method TEXT NOT NULL DEFAULT 'direct_hours',
      currency TEXT NOT NULL DEFAULT '₹',
      include_bench_in_overhead BOOLEAN NOT NULL DEFAULT FALSE
    )`;
  await sql`INSERT INTO fin_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
  await sql`
    CREATE TABLE IF NOT EXISTS fin_employee_meta (
      employee_id TEXT PRIMARY KEY,
      cost_type TEXT NOT NULL DEFAULT 'direct',
      capacity_hours NUMERIC,
      active BOOLEAN NOT NULL DEFAULT TRUE
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS fin_project_revenue (
      project_id TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      billing_type TEXT NOT NULL DEFAULT 'fixed',
      fixed_amount NUMERIC NOT NULL DEFAULT 0,
      hourly_rate NUMERIC NOT NULL DEFAULT 0,
      billable_hours NUMERIC NOT NULL DEFAULT 0,
      PRIMARY KEY (project_id, month, year)
    )`;
  // Multi-currency support on Billing Setup — mirrors what we did for
  // invoices. Lets coordinators set Upwork projects in USD; the INR
  // equivalent is locked at save time using the FX-rate endpoint.
  try {
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR'`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS fx_rate NUMERIC`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS revenue_inr NUMERIC`;
    // Backfill legacy rows: assume INR @ rate 1, INR = fixed or hourly*hours
    await sql`
      UPDATE fin_project_revenue
      SET currency=COALESCE(currency, 'INR'),
          fx_rate=COALESCE(fx_rate, 1),
          revenue_inr=COALESCE(revenue_inr,
            CASE WHEN billing_type='hourly' THEN hourly_rate * billable_hours
                 ELSE fixed_amount END)
      WHERE currency IS NULL OR revenue_inr IS NULL`;
    // Clearance workflow for Upwork billing: coordinator enters the invoiced
    // amount (status=pending → counts as revenue), admin marks cleared with
    // the actual amount received (status=cleared → drives realized revenue,
    // mirrors fin_project_invoices). Variance (Upwork fee, FX) lands on net.
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS amount_received NUMERIC`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS received_inr NUMERIC`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS received_fx_rate NUMERIC`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS cleared_by TEXT`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS cleared_by_name TEXT`;
    await sql`ALTER TABLE fin_project_revenue ADD COLUMN IF NOT EXISTS clearance_note TEXT`;
    await sql`UPDATE fin_project_revenue SET status='pending' WHERE status IS NULL`;
  } catch { /* idempotent */ }
  await sql`
    CREATE TABLE IF NOT EXISTS fin_other_costs (
      id SERIAL PRIMARY KEY,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'general'
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_other_costs_period ON fin_other_costs(year, month)`.catch(()=>{});

  // Per-project direct expenses — outsourced services, content, ad spend, etc.
  // Deducted from that project's revenue in the profitability calculation,
  // unlike fin_other_costs which is the org-wide overhead pool.
  await sql`
    CREATE TABLE IF NOT EXISTS fin_project_expenses (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      vendor TEXT,
      description TEXT NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'outsource',
      created_by TEXT,
      created_by_role TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_proj_exp_period ON fin_project_expenses(year, month)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_proj_exp_project ON fin_project_expenses(project_id, year, month)`.catch(()=>{});

  // Per-project invoices — coordinator raises (amount_invoiced), admin clears
  // with the actual received amount. Multiple invoices per project per month
  // are allowed (retainer + ad-hoc deliverable).
  await sql`
    CREATE TABLE IF NOT EXISTS fin_project_invoices (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      invoice_number TEXT,
      invoice_date DATE,
      amount_invoiced NUMERIC NOT NULL DEFAULT 0,
      amount_received NUMERIC,
      status TEXT NOT NULL DEFAULT 'pending',
      cleared_date DATE,
      cleared_by TEXT,
      cleared_by_name TEXT,
      notes TEXT,
      created_by TEXT,
      created_by_name TEXT,
      created_by_role TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_invoices_period ON fin_project_invoices(year, month)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_invoices_project ON fin_project_invoices(project_id, year, month)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_invoices_status ON fin_project_invoices(status)`.catch(()=>{});

  // Multi-currency support — most invoices are raised in USD but the bank
  // receives INR after FX conversion. We keep both: amount_invoiced is what
  // the coordinator typed (in `currency`), amount_invoiced_inr is the INR
  // equivalent at fx_rate, used as the home-currency revenue figure.
  try {
    await sql`ALTER TABLE fin_project_invoices ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR'`;
    await sql`ALTER TABLE fin_project_invoices ADD COLUMN IF NOT EXISTS fx_rate NUMERIC`;
    await sql`ALTER TABLE fin_project_invoices ADD COLUMN IF NOT EXISTS amount_invoiced_inr NUMERIC`;
    // Backfill: legacy rows had no currency → they were all INR @ rate 1
    await sql`
      UPDATE fin_project_invoices
      SET currency=COALESCE(currency,'INR'),
          fx_rate=COALESCE(fx_rate, 1),
          amount_invoiced_inr=COALESCE(amount_invoiced_inr, amount_invoiced)
      WHERE currency IS NULL OR amount_invoiced_inr IS NULL`;
    // Backfill: align month/year with invoice_date when they drifted (e.g.
    // user raised in June but dated the invoice in May — the picker won, so
    // the row says June even though it belongs to May). invoice_date is the
    // source of truth, so we update month/year to match.
    await sql`
      UPDATE fin_project_invoices
      SET month = EXTRACT(MONTH FROM invoice_date)::int,
          year  = EXTRACT(YEAR FROM invoice_date)::int
      WHERE invoice_date IS NOT NULL
        AND (EXTRACT(MONTH FROM invoice_date)::int <> month
          OR EXTRACT(YEAR FROM invoice_date)::int <> year)`;
  } catch { /* idempotent best-effort */ }

  // Daily FX-rate cache so we don't hammer Frankfurter on every invoice load.
  // Frankfurter only returns business-day rates; weekends/holidays fall back
  // to the last business day (its native behavior).
  await sql`
    CREATE TABLE IF NOT EXISTS fin_fx_rates (
      rate_date DATE NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      rate NUMERIC NOT NULL,
      fetched_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (rate_date, from_currency, to_currency)
    )`;

  // Mark Upwork-billed projects so the UI can label invoices appropriately
  // and pre-select USD on the invoice form. 'direct' is the catch-all for
  // anything not on Upwork (retainer, project-based, etc.).
  try {
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS billing_source TEXT DEFAULT 'direct'`;
  } catch { /* idempotent */ }

  // Role-based playbook — every employee with that role inherits these items.
  // Sections (Daily / Weekly / Monthly / etc.) group items; frequency drives
  // the colored pill on each item. where_to_do is a short nav breadcrumb
  // so the employee can find the screen referenced (e.g. "Project Mgmt → Hours grid").
  await sql`
    CREATE TABLE IF NOT EXISTS role_responsibilities (
      id SERIAL PRIMARY KEY,
      role TEXT NOT NULL,
      section_name TEXT NOT NULL,
      section_order INTEGER NOT NULL DEFAULT 0,
      item_order INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      details TEXT,
      frequency TEXT,
      where_to_do TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_role_resp_role ON role_responsibilities(role, section_order, item_order)`.catch(()=>{});
  await seedRoleResponsibilities();

  // Per-employee R&R overlay. The role-level template stays the baseline
  // everyone with that role sees; this table holds items that are *specific*
  // to one employee (custom expectations layered on top by admin / HR / their
  // reporting manager). The employee sees these; the role template comes
  // along for the ride read-only.
  await sql`
    CREATE TABLE IF NOT EXISTS employee_responsibilities (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      section_name TEXT NOT NULL,
      section_order INTEGER NOT NULL DEFAULT 0,
      item_order INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      details TEXT,
      frequency TEXT,
      where_to_do TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_emp_resp_emp ON employee_responsibilities(employee_id, section_order, item_order)`.catch(()=>{});

  // Change log: who created / edited / deleted which item, and what the data
  // looked like before vs after. Visible only to admin / HR / reporting manager
  // so they can see when expectations were rewritten and by whom.
  await sql`
    CREATE TABLE IF NOT EXISTS employee_responsibilities_audit (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      item_id INTEGER,
      action TEXT NOT NULL,
      title TEXT,
      before_data JSONB,
      after_data JSONB,
      reason TEXT,
      actor_id TEXT,
      actor_name TEXT,
      actor_role TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_emp_resp_audit_emp ON employee_responsibilities_audit(employee_id, created_at DESC)`.catch(()=>{});

  // ── Performance Pulse: automated 30-day score, runs alongside the manual
  // monthly_performance reviews. snapshots = one row per employee per day,
  // pulse_ratings = weekly manager emoji input, weights = per-dept overrides
  // (default everywhere is equal weight).
  await sql`
    CREATE TABLE IF NOT EXISTS performance_score_snapshots (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      discipline NUMERIC,
      hours_hygiene NUMERIC,
      output NUMERIC,
      contribution NUMERIC,
      manager_pulse NUMERIC,
      team_stewardship NUMERIC,
      project_hygiene NUMERIC,
      total_score NUMERIC NOT NULL,
      band TEXT NOT NULL,
      is_baseline BOOLEAN DEFAULT FALSE,
      breakdown JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, snapshot_date)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_perf_snap_emp_date ON performance_score_snapshots(employee_id, snapshot_date DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_perf_snap_date ON performance_score_snapshots(snapshot_date DESC)`.catch(()=>{});

  await sql`
    CREATE TABLE IF NOT EXISTS performance_manager_pulse (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      manager_id TEXT NOT NULL,
      week_start DATE NOT NULL,
      rating TEXT NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, manager_id, week_start)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_perf_pulse_emp_week ON performance_manager_pulse(employee_id, week_start DESC)`.catch(()=>{});

  await sql`
    CREATE TABLE IF NOT EXISTS performance_score_weights (
      department TEXT PRIMARY KEY,
      discipline NUMERIC NOT NULL DEFAULT 1,
      hours_hygiene NUMERIC NOT NULL DEFAULT 1,
      output NUMERIC NOT NULL DEFAULT 1,
      contribution NUMERIC NOT NULL DEFAULT 1,
      manager_pulse NUMERIC NOT NULL DEFAULT 1,
      team_stewardship NUMERIC NOT NULL DEFAULT 1,
      project_hygiene NUMERIC NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT
    )`;
  await sql`INSERT INTO performance_score_weights (department) VALUES ('_default') ON CONFLICT (department) DO NOTHING`;

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
    // Optional total-hours cap per project (one-time / fixed-budget projects).
    // Null = uncapped / recurring.
    await sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS total_hours_cap NUMERIC`.catch(()=>{});
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
    const { reporting_manager_id, descendants } = req.query as any;
    if (reporting_manager_id) {
      // descendants=true walks the entire reporting tree under this manager,
      // so a 2nd/3rd/Nth-level reporting manager sees the full sub-tree (their
      // direct reports AND everyone reporting to those reports, recursively).
      if (descendants === 'true' || descendants === '1') {
        const rows = await sql`
          WITH RECURSIVE team AS (
            SELECT * FROM employees WHERE reporting_manager_id = ${reporting_manager_id}
            UNION ALL
            SELECT e.* FROM employees e
            JOIN team t ON e.reporting_manager_id = t.id
          )
          SELECT * FROM team ORDER BY name`;
        res.json(rows);
      } else {
        res.json(await sql`SELECT * FROM employees WHERE reporting_manager_id = ${reporting_manager_id} ORDER BY name`);
      }
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
    // Cascade the name change to every table that denormalises employee_name.
    // Without this, renaming an employee leaves stale labels on past assignments,
    // logs, leave requests, etc. — reviewers see the OLD name on these surfaces.
    if (updated?.id && name !== undefined) {
      const empId = updated.id;
      const cascades = [
        sql`UPDATE project_assignments SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE hour_logs           SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE hour_log_days       SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE leave_requests      SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE wfh_requests        SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE employee_warnings   SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE employee_pips       SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE upsell_requests     SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE expense_requests    SET employee_name=${name} WHERE employee_id=${empId}`,
        sql`UPDATE repair_tickets      SET employee_name=${name} WHERE employee_id=${empId}`,
      ];
      // Best-effort — a missing table (in a fresh DB) shouldn't fail the update.
      await Promise.all(cascades.map(p => (p as any).catch(() => {})));
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
    // Pull holidays in scope so we can mark any matching date as 'holiday'
    // (overriding 'absent' / etc). The UI then knows not to count it against
    // the employee.
    let holidayRows: any[] = [];
    try {
      holidayRows = (month && year)
        ? await sql`SELECT date, name FROM holidays WHERE EXTRACT(MONTH FROM date)=${Number(month)} AND EXTRACT(YEAR FROM date)=${Number(year)}` as any
        : await sql`SELECT date, name FROM holidays` as any;
    } catch { holidayRows = []; }
    const holidayMap = new Map<string, string>();
    for (const h of holidayRows) {
      const d = String(h.date instanceof Date ? h.date.toISOString() : h.date).slice(0, 10);
      holidayMap.set(d, h.name);
    }
    const result = (rows as any[])
      .map(normDateV)
      .filter((r: any) => !isWeekendV(r.date) && r.date <= todayV)
      .map((r: any) => holidayMap.has(r.date)
        ? { ...r, status: 'holiday', holiday_name: holidayMap.get(r.date) }
        : r);
    res.json(result);
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
  // Default window covers TODAY + the day before. Biometric punches for
  // "yesterday" sometimes only land in the eTimeOffice DB after midnight
  // (when an employee clocks out late) so the auto-sync needs to keep
  // updating the prior day until everyone has cleared. Explicit fromDate /
  // toDate from the caller override this.
  const yest = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  const from  = fromDate ?? yest;
  const to    = toDate   ?? today;
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

// ─────────────────────────────────────────────────────────────────────────
// Performance Pulse — automated score, 30-day rolling window.
// Runs nightly after biometric sync. Persists one snapshot per employee
// per day so we can show trend lines without recomputing history.
//
// Five base pillars (everyone):
//   Discipline, Hours hygiene, Output, Contribution, Manager pulse
// Two role pillars (added if applicable):
//   Team stewardship (reporting managers)
//   Project hygiene (project coordinators)
//
// Each pillar produces a 0–100 sub-score; missing-signal pillars
// redistribute their weight to the rest. Result is rounded to nearest int.
// ─────────────────────────────────────────────────────────────────────────
function bandFor(score: number): string {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'strong';
  if (score >= 50) return 'building';
  return 'needs_support';
}
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

async function computePulseForDate(asOf: string) {
  // 30-day window ending at asOf (inclusive)
  const windowStart = new Date(asOf);
  windowStart.setUTCDate(windowStart.getUTCDate() - 29);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  // Pulse rating cutoff (last 4 weeks)
  const pulseStart = new Date(asOf);
  pulseStart.setUTCDate(pulseStart.getUTCDate() - 28);
  const pulseStartStr = pulseStart.toISOString().slice(0, 10);

  const employees = await sql`
    SELECT e.id, e.name, e.department, e.reporting_manager_id, e.join_date, e.shift, e.status,
           u.role
    FROM employees e
    LEFT JOIN app_users u ON u.employee_id_ref = e.id
    WHERE e.status = 'active' OR e.status IS NULL` as any[];

  // Pre-fetch all aggregates in window once. Cheaper than per-employee.
  const attendance = await sql`
    SELECT employee_id, date, status, check_in, total_hours
    FROM attendance_records
    WHERE date BETWEEN ${windowStartStr}::date AND ${asOf}::date` as any[];
  const leaves = await sql`
    SELECT employee_id, from_date, to_date, status, applied_on
    FROM leave_requests
    WHERE NOT (to_date < ${windowStartStr}::date OR from_date > ${asOf}::date)` as any[];
  const hourDays = await sql`
    SELECT employee_id, project_id, log_date, hours, notes, created_at
    FROM hour_log_days
    WHERE log_date BETWEEN ${windowStartStr}::date AND ${asOf}::date` as any[];
  const hourLogs = await sql`
    SELECT employee_id, status, reviewed_at, submitted_at, hours_logged, reviewed_by_id
    FROM hour_logs
    WHERE submitted_at >= ${windowStartStr}::date` as any[];
  const goals = await sql`
    SELECT employee_id, status, progress, target_date
    FROM performance_goals
    WHERE created_at >= ${windowStartStr}::date OR (target_date IS NULL OR target_date >= ${windowStartStr}::date)` as any[];
  const upsells = await sql`
    SELECT employee_id, status, created_at
    FROM upsell_requests
    WHERE created_at >= ${windowStartStr}::date` as any[];
  const pulseRatings = await sql`
    SELECT employee_id, rating, week_start
    FROM performance_manager_pulse
    WHERE week_start >= ${pulseStartStr}::date` as any[];
  const assignments = await sql`
    SELECT project_id, employee_id, month, year, monthly_hours
    FROM project_assignments
    WHERE monthly_hours > 0` as any[];
  const activeProjects = await sql`
    SELECT id, project_reporting_id, project_lead_id, created_by
    FROM projects WHERE status='active'` as any[];

  // index lookups
  const attByEmp = new Map<string, any[]>();
  attendance.forEach(r => { (attByEmp.get(r.employee_id) ?? attByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });
  const leaveByEmp = new Map<string, any[]>();
  leaves.forEach(r => { (leaveByEmp.get(r.employee_id) ?? leaveByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });
  const hdByEmp = new Map<string, any[]>();
  hourDays.forEach(r => { (hdByEmp.get(r.employee_id) ?? hdByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });
  const hlByEmp = new Map<string, any[]>();
  hourLogs.forEach(r => { (hlByEmp.get(r.employee_id) ?? hlByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });
  const goalsByEmp = new Map<string, any[]>();
  goals.forEach(r => { (goalsByEmp.get(r.employee_id) ?? goalsByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });
  const upsellByEmp = new Map<string, any[]>();
  upsells.forEach(r => { (upsellByEmp.get(r.employee_id) ?? upsellByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });
  const pulseByEmp = new Map<string, any[]>();
  pulseRatings.forEach(r => { (pulseByEmp.get(r.employee_id) ?? pulseByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });

  // helpers
  const workingDays = (() => {
    let d = new Date(windowStartStr);
    const end = new Date(asOf);
    let c = 0;
    while (d <= end) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) c++; d.setUTCDate(d.getUTCDate() + 1); }
    return Math.max(1, c);
  })();

  const empById = new Map(employees.map(e => [e.id, e]));
  // direct reports lookup
  const reportsByMgr = new Map<string, any[]>();
  employees.forEach(e => {
    if (e.reporting_manager_id) {
      const arr = reportsByMgr.get(e.reporting_manager_id) ?? [];
      arr.push(e); reportsByMgr.set(e.reporting_manager_id, arr);
    }
  });

  const snapshots: Array<{ employee_id: string; pillars: any; total: number; band: string; baseline: boolean; breakdown: any }> = [];

  for (const emp of employees) {
    const empId = emp.id;
    const isNewJoiner = emp.join_date && (new Date(asOf).getTime() - new Date(emp.join_date).getTime()) / 86400000 < 30;

    // ── Discipline ────────────────────────────────────────────────────
    const att = attByEmp.get(empId) ?? [];
    let lateCount = 0, absences = 0;
    const shiftStart = emp.shift === 'night' ? '22:00' : '09:30';
    const [shH, shM] = shiftStart.split(':').map(Number);
    const shiftMin = shH * 60 + shM;
    for (const a of att) {
      if (a.status === 'absent') absences++;
      else if (a.check_in) {
        const [h, m] = String(a.check_in).split(':').map(Number);
        if (!Number.isNaN(h) && (h * 60 + m) > shiftMin + 15) lateCount++; // 15-min grace
      }
    }
    // Leave-without-notice: leave applied <= day of from_date
    const lwn = (leaveByEmp.get(empId) ?? []).filter(l => {
      if (!l.applied_on || !l.from_date) return false;
      return new Date(l.applied_on).toISOString().slice(0, 10) >= String(l.from_date).slice(0, 10);
    }).length;
    const discipline = clamp(100 - lateCount * 5 - absences * 15 - lwn * 20, 0, 100);

    // ── Hours hygiene ─────────────────────────────────────────────────
    const hd = hdByEmp.get(empId) ?? [];
    const daysLogged = new Set(hd.map(r => String(r.log_date).slice(0, 10))).size;
    const daysWithNotes = new Set(hd.filter(r => (r.notes ?? '').trim().length > 0).map(r => String(r.log_date).slice(0, 10))).size;
    const hh = clamp((daysLogged / workingDays) * 70 + (daysLogged ? (daysWithNotes / daysLogged) * 30 : 0), 0, 100);

    // ── Output ────────────────────────────────────────────────────────
    const hl = hlByEmp.get(empId) ?? [];
    const totalHrsLogged = hd.reduce((s, r) => s + Number(r.hours ?? 0), 0);
    const capacityHrs = workingDays * 8;
    const utilPct = capacityHrs ? clamp((totalHrsLogged / capacityHrs) * 100, 0, 100) : 0;
    const approved = hl.filter(r => r.status === 'approved').length;
    const submitted = hl.filter(r => r.status !== 'pending').length;
    const approvalRate = submitted ? (approved / submitted) * 100 : 100;
    const output = clamp(utilPct * 0.7 + approvalRate * 0.3, 0, 100);

    // ── Contribution ──────────────────────────────────────────────────
    const gs = goalsByEmp.get(empId) ?? [];
    const goalsOnTrack = gs.filter(g => g.status === 'completed' || (Number(g.progress) >= 50 && g.status !== 'at_risk')).length;
    const goalsPct = gs.length ? (goalsOnTrack / gs.length) * 100 : null;
    const upsellCount = (upsellByEmp.get(empId) ?? []).filter(u => u.status !== 'rejected').length;
    const contribBonus = Math.min(40, upsellCount * 10);
    const contribution = goalsPct == null
      ? clamp(60 + contribBonus, 0, 100)              // no goals → baseline 60 + bonus
      : clamp(goalsPct * 0.6 + contribBonus, 0, 100);

    // ── Manager pulse ─────────────────────────────────────────────────
    const pulses = pulseByEmp.get(empId) ?? [];
    const pulseScores = pulses.map(p => p.rating === 'good' ? 100 : p.rating === 'ok' ? 60 : 20);
    const managerPulse = pulseScores.length >= 2
      ? pulseScores.reduce((s, n) => s + n, 0) / pulseScores.length
      : null;

    // ── Team stewardship (managers only) ──────────────────────────────
    const directReports = reportsByMgr.get(empId) ?? [];
    let teamStewardship: number | null = null;
    let stewardshipDetail: any = null;
    if (directReports.length > 0) {
      // approval timeliness on logs where this person is the approver
      const myApprovals = hourLogs.filter(r => r.reviewed_by_id === empId && r.status === 'approved');
      let timely = 0;
      for (const a of myApprovals) {
        if (a.reviewed_at && a.submitted_at) {
          const dh = (new Date(a.reviewed_at).getTime() - new Date(a.submitted_at).getTime()) / 3600000;
          if (dh <= 48) timely++;
        }
      }
      const approvalTimely = myApprovals.length ? (timely / myApprovals.length) * 100 : 100;
      // team logging hygiene = avg of each report's hours-hygiene
      const teamHh: number[] = [];
      for (const r of directReports) {
        const rhd = hdByEmp.get(r.id) ?? [];
        const dl = new Set(rhd.map(x => String(x.log_date).slice(0, 10))).size;
        teamHh.push((dl / workingDays) * 100);
      }
      const teamHygiene = teamHh.length ? teamHh.reduce((s, n) => s + n, 0) / teamHh.length : 0;
      teamStewardship = clamp(approvalTimely * 0.5 + teamHygiene * 0.5, 0, 100);
      stewardshipDetail = { approval_timeliness: Math.round(approvalTimely), team_logging_hygiene: Math.round(teamHygiene), team_size: directReports.length, approvals_made: myApprovals.length };
    }

    // ── Project hygiene (coordinators only) ───────────────────────────
    let projectHygiene: number | null = null;
    let projHygieneDetail: any = null;
    if (emp.role === 'project_coordinator' || emp.role === 'admin') {
      // For coordinators: across all active projects, did assigned people log? Were logs approved on time?
      const projScores: number[] = [];
      let totalAssigned = 0, totalLogged = 0;
      for (const p of activeProjects) {
        const assigned = assignments.filter(a => a.project_id === p.id);
        if (!assigned.length) continue;
        const empsOnProj = new Set(assigned.map(a => a.employee_id));
        totalAssigned += empsOnProj.size;
        let logged = 0;
        empsOnProj.forEach(eid => {
          // assigned employee counts as "logged" if they logged hours on THIS project in window
          const had = (hdByEmp.get(eid) ?? []).some(d => d.project_id === p.id);
          if (had) logged++;
        });
        totalLogged += logged;
        const coverage = empsOnProj.size ? (logged / empsOnProj.size) * 100 : 0;
        projScores.push(coverage);
      }
      const coverage = projScores.length ? projScores.reduce((s, n) => s + n, 0) / projScores.length : 0;
      // approval flow-through across the org (coord owns the bottleneck globally)
      const allLogsWindow = hourLogs.filter(r => r.status === 'approved' || r.status === 'pending');
      const pendingOver2d = allLogsWindow.filter(r => {
        if (r.status !== 'pending' || !r.submitted_at) return false;
        return (new Date(asOf).getTime() - new Date(r.submitted_at).getTime()) / 86400000 > 2;
      }).length;
      const flowThrough = allLogsWindow.length ? clamp(100 - (pendingOver2d / allLogsWindow.length) * 100, 0, 100) : 100;
      projectHygiene = clamp(coverage * 0.5 + flowThrough * 0.5, 0, 100);
      projHygieneDetail = { logging_coverage: Math.round(coverage), approval_flow_through: Math.round(flowThrough), active_projects: activeProjects.length, employees_logged: totalLogged, employees_assigned: totalAssigned };
    }

    // ── Aggregate with equal weights; redistribute missing pillars ─────
    const pillars: Record<string, number | null> = {
      discipline, hours_hygiene: hh, output, contribution,
      manager_pulse: managerPulse,
      team_stewardship: teamStewardship,
      project_hygiene: projectHygiene,
    };
    const present = Object.entries(pillars).filter(([, v]) => v != null) as [string, number][];
    const total = present.length ? present.reduce((s, [, v]) => s + v, 0) / present.length : 0;
    const rounded = Math.round(total);

    const breakdown: any = {
      discipline_misses: { late: lateCount, absences, leave_without_notice: lwn },
      hygiene: { working_days: workingDays, days_logged: daysLogged, days_with_notes: daysWithNotes },
      output_detail: { utilization_pct: Math.round(utilPct), approval_rate_pct: Math.round(approvalRate), hours_logged: Math.round(totalHrsLogged), capacity_hours: capacityHrs },
      contribution_detail: { goals_total: gs.length, goals_on_track: goalsOnTrack, upsells: upsellCount },
      manager_pulse_detail: { ratings_in_window: pulses.length, avg: managerPulse != null ? Math.round(managerPulse) : null },
      team_stewardship_detail: stewardshipDetail,
      project_hygiene_detail: projHygieneDetail,
    };

    snapshots.push({
      employee_id: empId,
      pillars: {
        discipline: Math.round(discipline),
        hours_hygiene: Math.round(hh),
        output: Math.round(output),
        contribution: Math.round(contribution),
        manager_pulse: managerPulse != null ? Math.round(managerPulse) : null,
        team_stewardship: teamStewardship != null ? Math.round(teamStewardship) : null,
        project_hygiene: projectHygiene != null ? Math.round(projectHygiene) : null,
      },
      total: rounded,
      band: isNewJoiner ? 'baseline' : bandFor(rounded),
      baseline: !!isNewJoiner,
      breakdown,
    });
  }

  // upsert snapshots
  for (const s of snapshots) {
    await sql`
      INSERT INTO performance_score_snapshots
        (employee_id, snapshot_date, discipline, hours_hygiene, output, contribution,
         manager_pulse, team_stewardship, project_hygiene, total_score, band, is_baseline, breakdown)
      VALUES (${s.employee_id}, ${asOf}::date,
              ${s.pillars.discipline}, ${s.pillars.hours_hygiene}, ${s.pillars.output}, ${s.pillars.contribution},
              ${s.pillars.manager_pulse}, ${s.pillars.team_stewardship}, ${s.pillars.project_hygiene},
              ${s.total}, ${s.band}, ${s.baseline}, ${JSON.stringify(s.breakdown)}::jsonb)
      ON CONFLICT (employee_id, snapshot_date) DO UPDATE SET
        discipline=EXCLUDED.discipline, hours_hygiene=EXCLUDED.hours_hygiene,
        output=EXCLUDED.output, contribution=EXCLUDED.contribution,
        manager_pulse=EXCLUDED.manager_pulse, team_stewardship=EXCLUDED.team_stewardship,
        project_hygiene=EXCLUDED.project_hygiene, total_score=EXCLUDED.total_score,
        band=EXCLUDED.band, is_baseline=EXCLUDED.is_baseline, breakdown=EXCLUDED.breakdown`;
  }

  // ── Notification side-effects ─────────────────────────────────────────
  // Day of week in UTC. Friday = 5, Monday = 1. We fire the manager-prompt on
  // Monday and the weekly self-digest on Friday so they don't pile up daily.
  const dow = new Date(asOf).getUTCDay();
  try {
    // Score-drop nudges: any employee whose score is ≥10 lower than the same
    // weekday a week ago. Notify their reporting manager. Quiet on baseline rows.
    const drops = await sql`
      WITH today AS (
        SELECT employee_id, total_score
        FROM performance_score_snapshots
        WHERE snapshot_date=${asOf}::date AND is_baseline=FALSE
      ),
      prior AS (
        SELECT employee_id, total_score AS prior_score
        FROM performance_score_snapshots
        WHERE snapshot_date=(${asOf}::date - INTERVAL '7 days')::date
      )
      SELECT t.employee_id, t.total_score, p.prior_score, e.name AS emp_name, e.reporting_manager_id
      FROM today t
      JOIN prior p USING (employee_id)
      JOIN employees e ON e.id=t.employee_id
      WHERE p.prior_score - t.total_score >= 10` as any[];
    for (const d of drops) {
      if (!d.reporting_manager_id) continue;
      const mgrUser = (await sql`SELECT id FROM app_users WHERE employee_id_ref=${d.reporting_manager_id} AND active=TRUE`)[0] as any;
      if (!mgrUser) continue;
      await sql`INSERT INTO notifications (user_id, type, title, body)
        VALUES (${mgrUser.id}, 'pulse_score_drop', 'Pulse drop on your team',
                ${`${d.emp_name}'s pulse dropped ${Math.round(Number(d.prior_score) - Number(d.total_score))} pts (now ${d.total_score}). Worth a check-in.`})`;
    }
  } catch { /* non-fatal */ }

  if (dow === 1) {
    // Monday: nudge every manager who has at least one direct report
    try {
      const managers = await sql`
        SELECT DISTINCT e.reporting_manager_id AS mgr_id
        FROM employees e
        WHERE e.reporting_manager_id IS NOT NULL AND COALESCE(e.status,'active')='active'` as any[];
      for (const m of managers) {
        const mu = (await sql`SELECT id, name FROM app_users WHERE employee_id_ref=${m.mgr_id} AND active=TRUE`)[0] as any;
        if (!mu) continue;
        const teamSize = ((await sql`SELECT COUNT(*)::int AS c FROM employees WHERE reporting_manager_id=${m.mgr_id} AND COALESCE(status,'active')='active'`)[0] as any)?.c ?? 0;
        await sql`INSERT INTO notifications (user_id, type, title, body)
          VALUES (${mu.id}, 'pulse_rating_prompt', 'Weekly pulse rating',
                  ${`Tap a quick emoji per direct report (${teamSize}) — takes ~30s. Feeds the Manager Pulse pillar of their score.`})`;
      }
    } catch { /* non-fatal */ }
  }

  if (dow === 5) {
    // Friday: self digest. Compare today vs last Friday.
    try {
      const weekChange = await sql`
        WITH t AS (
          SELECT employee_id, total_score, band, is_baseline FROM performance_score_snapshots WHERE snapshot_date=${asOf}::date
        ),
        p AS (
          SELECT employee_id, total_score AS prior FROM performance_score_snapshots WHERE snapshot_date=(${asOf}::date - INTERVAL '7 days')::date
        )
        SELECT t.employee_id, t.total_score, t.band, t.is_baseline, p.prior
        FROM t LEFT JOIN p USING (employee_id)` as any[];
      for (const r of weekChange) {
        const u = (await sql`SELECT id FROM app_users WHERE employee_id_ref=${r.employee_id} AND active=TRUE`)[0] as any;
        if (!u) continue;
        const body = r.is_baseline
          ? `You're still in the baseline window — your first score appears once you've been here 30 days.`
          : r.prior == null
            ? `This week's pulse: ${r.total_score} (${(r.band ?? '').replace('_', ' ')}). Tap to see what's driving it.`
            : (() => {
                const delta = Math.round(Number(r.total_score) - Number(r.prior));
                const sign = delta > 0 ? '+' : '';
                return `This week's pulse: ${r.total_score} (${sign}${delta} vs last Friday). Tap for the breakdown.`;
              })();
        await sql`INSERT INTO notifications (user_id, type, title, body)
          VALUES (${u.id}, 'pulse_weekly_digest', 'Your weekly pulse', ${body})`;
      }
    } catch { /* non-fatal */ }
  }

  return { computed: snapshots.length, as_of: asOf };
}

// Cron entry point — Vercel hits this nightly. Reuses CRON_SECRET / x-vercel-cron auth.
app.all('/api/performance/pulse/cron', async (req, res) => {
  try {
    const auth = req.header('authorization') || '';
    const platformCron = !!req.header('x-vercel-cron');
    const secret = process.env.CRON_SECRET;
    const okToken = secret ? auth === `Bearer ${secret}` : false;
    if (!okToken && !platformCron) return res.status(401).json({ error: 'Unauthorized' });
    await runStartupMigrations();
    const today = new Date().toISOString().slice(0, 10);
    const result = await computePulseForDate(today);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Pulse compute failed' });
  }
});

// Manual recompute (admin only — used while developing or after a backfill).
// Runs migrations defensively in case this is the first hit since deploy and
// the pulse tables haven't been created yet — saves a "why is it empty?"
// debugging round-trip.
app.post('/api/performance/pulse/recompute', requireAdmin, async (req, res) => {
  try {
    await runStartupMigrations();
    const asOf = (req.body?.as_of as string) || new Date().toISOString().slice(0, 10);
    const result = await computePulseForDate(asOf);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Recompute failed' });
  }
});

// Pulse access helper:
//   admin/hr_manager  → any employee
//   the employee     → their own
//   reporting manager (direct OR through chain) → their report's
async function canViewPulse(viewer: any, targetEmpId: string): Promise<boolean> {
  if (!viewer) return false;
  if (viewer.role === 'admin' || viewer.role === 'hr_manager') return true;
  if (viewer.employee_id_ref === targetEmpId) return true;
  // walk up reporting chain
  let cur = targetEmpId;
  for (let i = 0; i < 10; i++) {
    const row = (await sql`SELECT reporting_manager_id FROM employees WHERE id=${cur}`)[0] as any;
    if (!row?.reporting_manager_id) return false;
    if (row.reporting_manager_id === viewer.employee_id_ref) return true;
    cur = row.reporting_manager_id;
  }
  return false;
}

// GET /api/performance/pulse/me — last snapshot + 8-week trend for current user
app.get('/api/performance/pulse/me', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u?.employee_id_ref) return res.status(404).json({ error: 'No employee profile linked to this user' });
    const empId = u.employee_id_ref;
    // Tolerate the table not existing yet — first call after deploy before
    // anyone has triggered a recompute would otherwise crash the Hub fetch.
    let latest: any = null; let trend: any[] = [];
    try {
      latest = (await sql`SELECT * FROM performance_score_snapshots WHERE employee_id=${empId} ORDER BY snapshot_date DESC LIMIT 1`)[0] ?? null;
      trend = await sql`
        SELECT snapshot_date, total_score, band FROM performance_score_snapshots
        WHERE employee_id=${empId} AND snapshot_date >= (CURRENT_DATE - INTERVAL '56 days')
        ORDER BY snapshot_date ASC` as any[];
    } catch { /* table missing — return null and let the UI prompt to recompute */ }
    res.json({ latest, trend });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/performance/pulse/team — current user's direct reports' latest scores
app.get('/api/performance/pulse/team', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const mgrEmpId = u.employee_id_ref;
    if (!mgrEmpId) return res.json({ team: [], week_start: null });
    // Run migrations defensively so a manager opening this tab for the first
    // time after deploy doesn't get a 500.
    await runStartupMigrations();
    const team = await sql`
      SELECT e.id, e.name, e.avatar, e.department, e.designation,
             s.total_score, s.band, s.discipline, s.hours_hygiene, s.output, s.contribution,
             s.manager_pulse, s.team_stewardship, s.project_hygiene, s.is_baseline, s.snapshot_date
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT * FROM performance_score_snapshots
        WHERE employee_id=e.id ORDER BY snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE e.reporting_manager_id=${mgrEmpId} AND COALESCE(e.status,'active')='active'
      ORDER BY s.total_score DESC NULLS LAST, e.name` as any[];
    // also surface which reports are missing a pulse rating this week
    const weekStart = (() => {
      const d = new Date(); const diff = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - diff); return d.toISOString().slice(0, 10);
    })();
    const pulses = await sql`
      SELECT employee_id, rating FROM performance_manager_pulse
      WHERE manager_id=${mgrEmpId} AND week_start=${weekStart}::date` as any[];
    const rated = new Set(pulses.map(p => p.employee_id));
    res.json({
      team: team.map(t => ({ ...t, pulse_rated_this_week: rated.has(t.id), week_start: weekStart })),
      week_start: weekStart,
    });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/performance/pulse/org — admin/HR org-wide grid
app.get('/api/performance/pulse/org', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u || !['admin', 'hr_manager'].includes(u.role)) return res.status(403).json({ error: 'Admin/HR only' });
    await runStartupMigrations();
    const rows = await sql`
      SELECT e.id, e.name, e.avatar, e.department, e.designation, e.reporting_manager_id,
             m.name AS reporting_manager_name,
             s.total_score, s.band, s.discipline, s.hours_hygiene, s.output, s.contribution,
             s.manager_pulse, s.team_stewardship, s.project_hygiene, s.is_baseline, s.snapshot_date
      FROM employees e
      LEFT JOIN employees m ON m.id = e.reporting_manager_id
      LEFT JOIN LATERAL (
        SELECT * FROM performance_score_snapshots
        WHERE employee_id=e.id ORDER BY snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE COALESCE(e.status,'active')='active'
      ORDER BY s.total_score DESC NULLS LAST, e.name` as any[];
    res.json({ employees: rows });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/performance/pulse/:employeeId — drawer detail (with access check)
app.get('/api/performance/pulse/:employeeId', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const viewer = (await sql`SELECT id, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    const ok = await canViewPulse(viewer, req.params.employeeId);
    if (!ok) return res.status(403).json({ error: 'Not permitted' });
    const latest = (await sql`SELECT * FROM performance_score_snapshots WHERE employee_id=${req.params.employeeId} ORDER BY snapshot_date DESC LIMIT 1`)[0] as any;
    const trend = await sql`
      SELECT snapshot_date, total_score, band FROM performance_score_snapshots
      WHERE employee_id=${req.params.employeeId} AND snapshot_date >= (CURRENT_DATE - INTERVAL '56 days')
      ORDER BY snapshot_date ASC` as any[];
    res.json({ latest: latest ?? null, trend });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// POST /api/performance/pulse-rating — manager submits emoji rating for a direct report
app.post('/api/performance/pulse-rating', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, employee_id_ref, name FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u?.employee_id_ref) return res.status(401).json({ error: 'Manager profile missing' });
    const { employee_id, rating, note, week_start } = req.body ?? {};
    if (!employee_id || !['good', 'ok', 'concern'].includes(rating)) {
      return res.status(400).json({ error: 'employee_id and rating (good|ok|concern) are required' });
    }
    // verify the rater is the actual reporting manager
    const target = (await sql`SELECT reporting_manager_id FROM employees WHERE id=${employee_id}`)[0] as any;
    if (!target || target.reporting_manager_id !== u.employee_id_ref) {
      return res.status(403).json({ error: 'You can only rate your direct reports' });
    }
    // week_start defaults to current Monday (UTC)
    const monday = week_start || (() => {
      const d = new Date(); const diff = (d.getUTCDay() + 6) % 7;
      d.setUTCDate(d.getUTCDate() - diff); return d.toISOString().slice(0, 10);
    })();
    const row = (await sql`
      INSERT INTO performance_manager_pulse (employee_id, manager_id, week_start, rating, note)
      VALUES (${employee_id}, ${u.employee_id_ref}, ${monday}::date, ${rating}, ${note ?? null})
      ON CONFLICT (employee_id, manager_id, week_start) DO UPDATE
        SET rating=EXCLUDED.rating, note=EXCLUDED.note
      RETURNING *`)[0];
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/performance/pulse/weights, PUT same — admin tune per department
app.get('/api/performance/pulse/weights', requireAdmin, async (_req, res) => {
  try {
    await runStartupMigrations();
    const rows = await sql`SELECT * FROM performance_score_weights ORDER BY department`;
    res.json({ weights: rows });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});
app.put('/api/performance/pulse/weights/:dept', requireAdmin, async (req, res) => {
  try {
    const { discipline, hours_hygiene, output, contribution, manager_pulse, team_stewardship, project_hygiene } = req.body ?? {};
    const row = (await sql`
      INSERT INTO performance_score_weights
        (department, discipline, hours_hygiene, output, contribution, manager_pulse, team_stewardship, project_hygiene, updated_at, updated_by)
      VALUES (${req.params.dept}, ${discipline ?? 1}, ${hours_hygiene ?? 1}, ${output ?? 1}, ${contribution ?? 1},
              ${manager_pulse ?? 1}, ${team_stewardship ?? 1}, ${project_hygiene ?? 1}, NOW(), ${req.header('x-user-id') ?? null})
      ON CONFLICT (department) DO UPDATE SET
        discipline=EXCLUDED.discipline, hours_hygiene=EXCLUDED.hours_hygiene, output=EXCLUDED.output,
        contribution=EXCLUDED.contribution, manager_pulse=EXCLUDED.manager_pulse,
        team_stewardship=EXCLUDED.team_stewardship, project_hygiene=EXCLUDED.project_hygiene,
        updated_at=NOW(), updated_by=${req.header('x-user-id') ?? null}
      RETURNING *`)[0];
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// Vercel Cron hits this — scheduled every 30 min in vercel.json. Vercel
// signs cron requests with a bearer token from CRON_SECRET (set in the
// project's env vars). We accept either that, or the Vercel platform's own
// 'x-vercel-cron' header, so the endpoint can't be triggered externally.
app.all('/api/attendance/biometric-sync/cron', async (req, res) => {
  try {
    const auth = req.header('authorization') || '';
    const platformCron = !!req.header('x-vercel-cron');
    const secret = process.env.CRON_SECRET;
    const okToken = secret ? auth === `Bearer ${secret}` : false;
    if (!okToken && !platformCron) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = await runBiometricSyncV('auto', 'vercel-cron');
    // Chain pulse compute — runs after attendance is fresh. Failure here
    // does NOT fail the sync response; pulse can be re-run via /recompute.
    let pulse: any = null;
    try { pulse = await computePulseForDate(new Date().toISOString().slice(0, 10)); }
    catch (e: any) { pulse = { error: e.message ?? 'pulse compute failed' }; }
    res.json({ ...result, pulse });
  } catch (err: any) {
    const today = new Date().toISOString().split('T')[0];
    try {
      await sql`INSERT INTO attendance_sync_log (sync_id,triggered,triggered_by,date_range,status,error_msg)
        VALUES(${crypto.randomUUID()},'auto','vercel-cron',${today},'failed',${err.message})`;
    } catch { /* non-fatal */ }
    res.status(500).json({ error: err.message ?? 'Sync failed' });
  }
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
    const { user_id, limit } = req.query as any;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    // The bell-icon dropdown uses 50; the dedicated /notifications page asks
    // for more so users can scroll their full history.
    const lim = Math.max(1, Math.min(500, Number(limit) || 50));
    const rows = await sql`SELECT * FROM notifications WHERE user_id=${user_id} ORDER BY created_at DESC LIMIT ${lim}`;
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

// ── Role responsibilities (playbook per role) ─────────────────────────────
// Read is open to any authenticated user — they need to see their own role's
// playbook. Mutations require admin so only HR can rewrite expectations.
app.get('/api/role-responsibilities', async (req, res) => {
  try {
    await runStartupMigrations();
    const role = (req.query.role as string) || null;
    const rows = role
      ? await sql`SELECT * FROM role_responsibilities WHERE role=${role} ORDER BY section_order, item_order, id`
      : await sql`SELECT * FROM role_responsibilities ORDER BY role, section_order, item_order, id`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/role-responsibilities', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const { role, section_name, section_order, item_order, title, details, frequency, where_to_do } = req.body;
    if (!role || !section_name?.trim() || !title?.trim()) return res.status(400).json({ error: 'role, section_name, title are required' });
    const rows = await sql`
      INSERT INTO role_responsibilities (role, section_name, section_order, item_order, title, details, frequency, where_to_do)
      VALUES (${role}, ${section_name.trim()}, ${Number(section_order) || 0}, ${Number(item_order) || 0},
              ${title.trim()}, ${details?.trim() || null}, ${frequency || null}, ${where_to_do?.trim() || null})
      RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/role-responsibilities/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const { section_name, section_order, item_order, title, details, frequency, where_to_do } = req.body;
    if (!section_name?.trim() || !title?.trim()) return res.status(400).json({ error: 'section_name, title are required' });
    const rows = await sql`
      UPDATE role_responsibilities SET
        section_name = ${section_name.trim()},
        section_order = ${Number(section_order) || 0},
        item_order = ${Number(item_order) || 0},
        title = ${title.trim()},
        details = ${details?.trim() || null},
        frequency = ${frequency || null},
        where_to_do = ${where_to_do?.trim() || null},
        updated_at = NOW()
      WHERE id=${Number(req.params.id)} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/role-responsibilities/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    await sql`DELETE FROM role_responsibilities WHERE id=${Number(req.params.id)}`;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Per-employee R&R access & helpers ─────────────────────────────────────
// READ: admin / HR / the employee themselves / anyone in their reporting chain (upward).
// WRITE: admin / HR / anyone in their reporting chain (NOT the employee — they can't
// edit their own expectations). AUDIT: write-permitted users only.
type RespCallerCheck = {
  ok: boolean;
  canWrite: boolean;
  canAudit: boolean;
  user?: { id: string; name: string; role: string; employee_id_ref: string | null };
};
async function respAccessCheck(req: any, employeeId: string): Promise<RespCallerCheck> {
  const userId = req.header('x-user-id') || req.query.__uid;
  if (!userId) return { ok: false, canWrite: false, canAudit: false };
  const userRows = await sql`SELECT id, name, role, employee_id_ref, active FROM app_users WHERE id=${userId} LIMIT 1`;
  const u = (userRows as any[])[0];
  if (!u || u.active !== true) return { ok: false, canWrite: false, canAudit: false };

  const isAdminish = u.role === 'admin' || u.role === 'hr_manager';
  if (isAdminish) {
    return { ok: true, canWrite: true, canAudit: true, user: u };
  }

  // Resolve caller's employee.id from their employee_id_ref
  let callerEmpDbId: string | null = null;
  if (u.employee_id_ref) {
    const er = await sql`SELECT id FROM employees WHERE employee_id=${u.employee_id_ref} LIMIT 1`;
    callerEmpDbId = (er as any[])[0]?.id ?? null;
  }

  // Self-read only
  const isSelf = !!callerEmpDbId && callerEmpDbId === employeeId;

  // Reporting chain: walk upward from target. If caller is an ancestor → manager-of-target.
  let isManagerChain = false;
  if (callerEmpDbId) {
    const chain = await sql`
      WITH RECURSIVE chain AS (
        SELECT id, reporting_manager_id FROM employees WHERE id=${employeeId}
        UNION ALL
        SELECT e.id, e.reporting_manager_id FROM employees e
        JOIN chain c ON e.id = c.reporting_manager_id
      )
      SELECT 1 FROM chain WHERE reporting_manager_id=${callerEmpDbId} LIMIT 1`;
    isManagerChain = (chain as any[]).length > 0;
  }

  if (isManagerChain) {
    return { ok: true, canWrite: true, canAudit: true, user: u };
  }
  if (isSelf) {
    return { ok: true, canWrite: false, canAudit: false, user: u };
  }
  return { ok: false, canWrite: false, canAudit: false };
}

async function logEmpRespAudit(p: {
  employee_id: string; item_id: number | null; action: 'create' | 'update' | 'delete';
  title: string | null; before: any; after: any; reason?: string | null;
  actor_id?: string | null; actor_name?: string | null; actor_role?: string | null;
}) {
  try {
    await sql`
      INSERT INTO employee_responsibilities_audit
        (employee_id, item_id, action, title, before_data, after_data, reason, actor_id, actor_name, actor_role)
      VALUES (${p.employee_id}, ${p.item_id}, ${p.action}, ${p.title},
              ${p.before ? JSON.stringify(p.before) : null}::jsonb,
              ${p.after ? JSON.stringify(p.after) : null}::jsonb,
              ${p.reason ?? null}, ${p.actor_id ?? null}, ${p.actor_name ?? null}, ${p.actor_role ?? null})`;
  } catch { /* non-fatal */ }
}

// GET — list items for an employee
app.get('/api/employee-responsibilities', async (req, res) => {
  try {
    await runStartupMigrations();
    const employeeId = (req.query.employee_id as string) || '';
    if (!employeeId) return res.status(400).json({ error: 'employee_id required' });
    const access = await respAccessCheck(req, employeeId);
    if (!access.ok) return res.status(403).json({ error: 'Not authorized' });
    const rows = await sql`
      SELECT * FROM employee_responsibilities
      WHERE employee_id=${employeeId}
      ORDER BY section_order, item_order, id`;
    res.json({ items: rows, can_write: access.canWrite, can_view_audit: access.canAudit });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// POST — add new personal item
app.post('/api/employee-responsibilities', async (req, res) => {
  try {
    await runStartupMigrations();
    const { employee_id, section_name, section_order, item_order, title, details, frequency, where_to_do, reason } = req.body;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    if (!section_name?.trim() || !title?.trim()) return res.status(400).json({ error: 'section_name and title are required' });
    const access = await respAccessCheck(req, employee_id);
    if (!access.ok) return res.status(403).json({ error: 'Not authorized' });
    if (!access.canWrite) return res.status(403).json({ error: 'You can view but not edit this employee\'s R&R' });

    const inserted = await sql`
      INSERT INTO employee_responsibilities
        (employee_id, section_name, section_order, item_order, title, details, frequency, where_to_do)
      VALUES (${employee_id}, ${section_name.trim()}, ${Number(section_order) || 0}, ${Number(item_order) || 0},
              ${title.trim()}, ${details?.trim() || null}, ${frequency || null}, ${where_to_do?.trim() || null})
      RETURNING *`;
    const row = (inserted as any[])[0];
    await logEmpRespAudit({
      employee_id, item_id: row.id, action: 'create', title: row.title,
      before: null, after: row, reason: reason ?? null,
      actor_id: access.user?.id, actor_name: access.user?.name, actor_role: access.user?.role,
    });
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// PUT — edit existing item
app.put('/api/employee-responsibilities/:id', async (req, res) => {
  try {
    await runStartupMigrations();
    const id = Number(req.params.id);
    const existing = (await sql`SELECT * FROM employee_responsibilities WHERE id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });
    const before = existing[0];
    const access = await respAccessCheck(req, before.employee_id);
    if (!access.ok) return res.status(403).json({ error: 'Not authorized' });
    if (!access.canWrite) return res.status(403).json({ error: 'You can view but not edit this employee\'s R&R' });

    const { section_name, section_order, item_order, title, details, frequency, where_to_do, reason } = req.body;
    if (!section_name?.trim() || !title?.trim()) return res.status(400).json({ error: 'section_name, title are required' });
    const updated = await sql`
      UPDATE employee_responsibilities SET
        section_name=${section_name.trim()},
        section_order=${Number(section_order) || 0},
        item_order=${Number(item_order) || 0},
        title=${title.trim()},
        details=${details?.trim() || null},
        frequency=${frequency || null},
        where_to_do=${where_to_do?.trim() || null},
        updated_at=NOW()
      WHERE id=${id} RETURNING *`;
    const after = (updated as any[])[0];
    await logEmpRespAudit({
      employee_id: before.employee_id, item_id: id, action: 'update', title: after.title,
      before, after, reason: reason ?? null,
      actor_id: access.user?.id, actor_name: access.user?.name, actor_role: access.user?.role,
    });
    res.json(after);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// DELETE — remove item
app.delete('/api/employee-responsibilities/:id', async (req, res) => {
  try {
    await runStartupMigrations();
    const id = Number(req.params.id);
    const existing = (await sql`SELECT * FROM employee_responsibilities WHERE id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Item not found' });
    const before = existing[0];
    const access = await respAccessCheck(req, before.employee_id);
    if (!access.ok) return res.status(403).json({ error: 'Not authorized' });
    if (!access.canWrite) return res.status(403).json({ error: 'You can view but not edit this employee\'s R&R' });

    await sql`DELETE FROM employee_responsibilities WHERE id=${id}`;
    await logEmpRespAudit({
      employee_id: before.employee_id, item_id: id, action: 'delete', title: before.title,
      before, after: null, reason: (req.body?.reason as string) ?? null,
      actor_id: access.user?.id, actor_name: access.user?.name, actor_role: access.user?.role,
    });
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// GET — change log
app.get('/api/employee-responsibilities/:employeeId/audit', async (req, res) => {
  try {
    await runStartupMigrations();
    const employeeId = req.params.employeeId;
    const access = await respAccessCheck(req, employeeId);
    if (!access.ok) return res.status(403).json({ error: 'Not authorized' });
    if (!access.canAudit) return res.status(403).json({ error: 'Audit log is admin / HR / reporting-manager only' });
    const rows = await sql`
      SELECT * FROM employee_responsibilities_audit
      WHERE employee_id=${employeeId}
      ORDER BY created_at DESC LIMIT 200`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
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

// ── Holidays (org-wide non-working days) ──────────────────────────────────
// Editable by admin/HR via Config; visible to all authenticated users so the
// holiday markings show up in attendance calendars / my-portal / my-team.
async function isAdminOrHR(req: any): Promise<boolean> {
  const userId = req.header('x-user-id') || req.query.__uid;
  if (!userId) return false;
  const rows = await sql`SELECT role, active FROM app_users WHERE id=${userId} LIMIT 1`;
  const u = (rows as any[])[0];
  return !!u && u.active === true && (u.role === 'admin' || u.role === 'hr_manager');
}

app.get('/api/holidays', async (req, res) => {
  try {
    await runStartupMigrations();
    const year = req.query.year ? Number(req.query.year) : null;
    const rows = year
      ? await sql`SELECT * FROM holidays WHERE EXTRACT(YEAR FROM date)=${year} ORDER BY date`
      : await sql`SELECT * FROM holidays ORDER BY date`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/holidays', async (req, res) => {
  try {
    await runStartupMigrations();
    if (!(await isAdminOrHR(req))) return res.status(403).json({ error: 'Admin / HR only' });
    const { date, name, type, notes } = req.body;
    if (!date || !name?.trim()) return res.status(400).json({ error: 'date and name are required' });
    const rows = await sql`
      INSERT INTO holidays (date, name, type, notes)
      VALUES (${date}, ${name.trim()}, ${type || 'public'}, ${notes?.trim() || null})
      ON CONFLICT (date) DO UPDATE SET
        name=EXCLUDED.name, type=EXCLUDED.type, notes=EXCLUDED.notes, updated_at=NOW()
      RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/holidays/:id', async (req, res) => {
  try {
    await runStartupMigrations();
    if (!(await isAdminOrHR(req))) return res.status(403).json({ error: 'Admin / HR only' });
    const { date, name, type, notes } = req.body;
    if (!date || !name?.trim()) return res.status(400).json({ error: 'date and name are required' });
    const rows = await sql`
      UPDATE holidays SET date=${date}, name=${name.trim()}, type=${type || 'public'},
        notes=${notes?.trim() || null}, updated_at=NOW()
      WHERE id=${Number(req.params.id)} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Holiday not found' });
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/holidays/:id', async (req, res) => {
  try {
    if (!(await isAdminOrHR(req))) return res.status(403).json({ error: 'Admin / HR only' });
    await sql`DELETE FROM holidays WHERE id=${Number(req.params.id)}`;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
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
    const { employee_id, employee_name, client_name, service_description, deal_value, notes, currency, fx_rate } = req.body;
    if (!employee_id || !client_name?.trim() || !service_description?.trim())
      return res.status(400).json({ error: 'employee_id, client_name, service_description are required' });
    if (deal_value !== undefined && deal_value !== null && Number(deal_value) <= 0)
      return res.status(400).json({ error: 'Deal value must be greater than 0' });
    // Context is now required — HR can't review an upsell without knowing
    // what happened with the client + what we're providing. 30-char floor
    // catches one-word entries like "more work" or "extension".
    const trimmedNotes = (notes ?? '').trim();
    if (trimmedNotes.length < 30) {
      return res.status(400).json({ error: 'Please add at least 30 characters describing what happened with the client and what extras you\'re providing.' });
    }
    // Currency + FX
    const ccy = (currency || 'INR').toUpperCase();
    let rate: number;
    if (fx_rate != null) rate = Number(fx_rate);
    else if (ccy === 'INR') rate = 1;
    else {
      const today = new Date().toISOString().slice(0, 10);
      rate = (await getFxRate(today, ccy, 'INR')).rate;
    }
    const dv = deal_value != null ? Number(deal_value) : null;
    const dvInr = dv != null ? dv * rate : null;
    const id = `ups_${Date.now()}`;
    const rows = await sql`
      INSERT INTO upsell_requests
        (id, employee_id, employee_name, client_name, service_description,
         deal_value, currency, fx_rate, deal_value_inr, notes)
      VALUES (${id}, ${employee_id}, ${employee_name ?? null}, ${client_name.trim()}, ${service_description.trim()},
              ${dv}, ${ccy}, ${rate}, ${dvInr}, ${trimmedNotes})
      RETURNING *`;
    const fmtDeal = dv != null
      ? (ccy === 'INR'
          ? `₹${Number(dv).toLocaleString('en-IN')}`
          : `${ccy} ${Number(dv).toLocaleString('en-IN')} (≈ ₹${Math.round(dvInr ?? 0).toLocaleString('en-IN')})`)
      : '';
    notifyAdminsAndHR('upsell_submitted','Upsell Incentive Request',
      `${employee_name??'An employee'} reported an upsell for "${client_name.trim()}"${fmtDeal ? ` — Deal: ${fmtDeal}` : ''}. Set their incentive amount.`).catch(()=>{});
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
  await sql`CREATE TABLE IF NOT EXISTS asset_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
  await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS category_id TEXT`.catch(()=>{});
  await sql`CREATE TABLE IF NOT EXISTS repair_tickets (id TEXT PRIMARY KEY, asset_id TEXT, laptop_info TEXT, employee_id TEXT, employee_name TEXT, vendor_id TEXT, issue TEXT NOT NULL, status TEXT DEFAULT 'reported', quoted_cost NUMERIC, final_cost NUMERIC, requires_approval BOOLEAN DEFAULT FALSE, approved_by TEXT, approved_at TIMESTAMPTZ, rejected_by TEXT, rejected_at TIMESTAMPTZ, rejection_reason TEXT, payment_status TEXT DEFAULT 'unpaid', payment_mode TEXT, payment_date DATE, notes TEXT, reported_at TIMESTAMPTZ DEFAULT NOW(), picked_up_at TIMESTAMPTZ, returned_at TIMESTAMPTZ, paid_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, created_by TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`.catch(()=>{});
  // Seed default categories the first time (idempotent — ON CONFLICT skips).
  for (const c of [
    { id: 'laptop',   name: 'Laptop' },
    { id: 'desktop',  name: 'Desktop' },
    { id: 'monitor',  name: 'Monitor' },
    { id: 'keyboard', name: 'Keyboard' },
    { id: 'mouse',    name: 'Mouse' },
    { id: 'headset',  name: 'Headset' },
    { id: 'phone',    name: 'Phone' },
    { id: 'printer',  name: 'Printer' },
    { id: 'router',   name: 'Router / Networking' },
  ]) {
    await sql`INSERT INTO asset_categories (id, name) VALUES (${c.id}, ${c.name}) ON CONFLICT (id) DO NOTHING`.catch(()=>{});
  }
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

// ── Asset categories ─────────────────────────────────────────────────────
app.get('/api/asset-categories', async (_req, res) => {
  try {
    await ensureRepairTables();
    res.json(await sql`SELECT * FROM asset_categories ORDER BY name ASC`);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/asset-categories', async (req, res) => {
  try {
    await ensureRepairTables();
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });
    const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const rows = await sql`INSERT INTO asset_categories (id, name) VALUES (${id}, ${name.trim()}) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name RETURNING *`;
    res.status(201).json((rows as any[])[0]);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/asset-categories/:id', async (req, res) => {
  try {
    // Block delete if any asset is using this category — preserves data
    const inUse = await sql`SELECT COUNT(*)::int AS c FROM assets WHERE category_id=${req.params.id}`;
    if (Number((inUse as any[])[0]?.c || 0) > 0) {
      return res.status(409).json({ error: 'Category in use by existing assets — reassign them first' });
    }
    await sql`DELETE FROM asset_categories WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Assets ────────────────────────────────────────────────────────────────
app.get('/api/assets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { assigned_to_id } = req.query as any;
    const rows = assigned_to_id
      ? await sql`SELECT a.*, c.name AS category_name FROM assets a LEFT JOIN asset_categories c ON c.id = a.category_id WHERE a.assigned_to_id=${assigned_to_id} ORDER BY a.asset_tag ASC`
      : await sql`SELECT a.*, c.name AS category_name FROM assets a LEFT JOIN asset_categories c ON c.id = a.category_id ORDER BY a.asset_tag ASC`;
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/assets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { asset_tag, category_id, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes } = req.body;
    if (!asset_tag?.trim()) return res.status(400).json({ error: 'Asset tag is required' });
    const id = `asset_${Date.now()}`;
    const rows = await sql`INSERT INTO assets (id, asset_tag, category_id, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes) VALUES (${id}, ${asset_tag.trim()}, ${category_id ?? null}, ${model ?? null}, ${serial_no ?? null}, ${purchase_date ?? null}, ${assigned_to_id ?? null}, ${assigned_to_name ?? null}, ${status ?? 'active'}, ${notes ?? null}) RETURNING *`;
    res.status(201).json((rows as any[])[0]);
  } catch (e: any) {
    if (e.message?.includes('unique')) return res.status(409).json({ error: 'Asset tag already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/assets/:id', async (req, res) => {
  try {
    const { asset_tag, category_id, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes } = req.body;
    if (!asset_tag?.trim()) return res.status(400).json({ error: 'Asset tag is required' });
    const rows = await sql`UPDATE assets SET asset_tag=${asset_tag.trim()}, category_id=${category_id ?? null}, model=${model ?? null}, serial_no=${serial_no ?? null}, purchase_date=${purchase_date ?? null}, assigned_to_id=${assigned_to_id ?? null}, assigned_to_name=${assigned_to_name ?? null}, status=${status ?? 'active'}, notes=${notes ?? null} WHERE id=${req.params.id} RETURNING *`;
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

// ── Per-asset repair history ─────────────────────────────────────────────
// Admin/HR only — returns every repair ever recorded against this asset
// with a running spend total. Powers the "Repair history" panel on the
// asset detail card so you can backtrack how much you've sunk into a piece
// of hardware over time.
app.get('/api/assets/:id/repair-history', async (req, res) => {
  try {
    await ensureRepairTables();
    if (!(await isAdminOrHR(req))) return res.status(403).json({ error: 'Admin / HR only' });
    const rows = await sql`
      SELECT r.*, v.name AS vendor_name
      FROM repair_tickets r
      LEFT JOIN vendors v ON v.id = r.vendor_id
      WHERE r.asset_id=${req.params.id}
      ORDER BY COALESCE(r.reported_at, r.created_by::timestamptz) DESC` as any[];
    const totalSpend = (rows as any[]).reduce((s, r) =>
      s + Number(r.final_cost ?? r.quoted_cost ?? 0), 0);
    res.json({
      asset_id: req.params.id,
      tickets: rows,
      ticket_count: rows.length,
      total_spend: totalSpend,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Repair tickets ────────────────────────────────────────────────────────
app.get('/api/repair-tickets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { employee_id, asset_id } = req.query as any;
    let rows: any[];
    if (employee_id) {
      rows = await sql`SELECT * FROM repair_tickets WHERE employee_id=${employee_id} ORDER BY reported_at DESC` as any[];
    } else if (asset_id) {
      rows = await sql`SELECT * FROM repair_tickets WHERE asset_id=${asset_id} ORDER BY reported_at DESC` as any[];
    } else {
      rows = await sql`SELECT * FROM repair_tickets ORDER BY reported_at DESC` as any[];
    }
    // Hide cost / payment / vendor / approval fields from employees so the
    // money trail (quoted, final, payment_mode, payment dates, vendor) never
    // shows up — not even in DevTools. Admin/HR (and the case where no
    // employee_id was supplied — only callable by admin UIs) keep full data.
    const userId = req.header('x-user-id') || (req.query as any).__uid;
    let isAdminish = false;
    if (userId) {
      const u = await sql`SELECT role, active FROM app_users WHERE id=${userId} LIMIT 1`.catch(() => []);
      const ur = (u as any[])[0];
      isAdminish = !!ur && ur.active === true && (ur.role === 'admin' || ur.role === 'hr_manager');
    }
    if (!isAdminish && employee_id) {
      const stripped = ['quoted_cost', 'final_cost', 'payment_status', 'payment_mode', 'payment_date',
                        'paid_at', 'vendor_id', 'approved_by', 'approved_at', 'rejected_by',
                        'rejected_at', 'rejection_reason', 'requires_approval', 'notes'];
      rows = rows.map(r => {
        const out: any = { ...r };
        for (const k of stripped) delete out[k];
        return out;
      });
    }
    res.json(rows);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/repair-tickets', async (req, res) => {
  try {
    await ensureRepairTables();
    const {
      asset_id, laptop_info, employee_id, employee_name, vendor_id, issue,
      quoted_cost, final_cost, notes, created_by,
      // Optional back-dating fields — used when admin enters historic repairs
      // ("we had this fixed in March, cost ₹4,500"). status defaults to
      // 'reported' for ongoing repairs and 'paid' for historic entries.
      reported_at, status, payment_status, payment_date,
    } = req.body;
    if (!issue?.trim()) return res.status(400).json({ error: 'Issue description is required' });
    if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
    if (quoted_cost != null && quoted_cost !== '' && Number(quoted_cost) < 0) {
      return res.status(400).json({ error: 'Cost cannot be negative' });
    }
    // Prevent multiple open tickets for the same asset — keeps asset.status
    // consistent. Historic entries (status='paid' or status='cancelled')
    // skip this check so admin can log past repairs even while a new one is
    // open.
    const incomingStatus = (status as string) || 'reported';
    const isHistoric = incomingStatus === 'paid' || incomingStatus === 'cancelled';
    if (asset_id && !isHistoric) {
      const openRows = await sql`SELECT id FROM repair_tickets WHERE asset_id=${asset_id} AND status NOT IN ('paid','cancelled')`;
      if ((openRows as any[]).length > 0) {
        return res.status(409).json({ error: 'This asset already has an open repair ticket. Close or cancel the existing one first.' });
      }
    }
    const id = `rep_${Date.now()}`;
    const rows = await sql`
      INSERT INTO repair_tickets (
        id, asset_id, laptop_info, employee_id, employee_name, vendor_id, issue,
        quoted_cost, final_cost, notes, created_by,
        status, payment_status, payment_date,
        reported_at, paid_at
      )
      VALUES (
        ${id}, ${asset_id ?? null}, ${laptop_info ?? null}, ${employee_id}, ${employee_name ?? null}, ${vendor_id ?? null}, ${issue.trim()},
        ${quoted_cost ?? null}, ${final_cost ?? null}, ${notes ?? null}, ${created_by ?? null},
        ${incomingStatus}, ${payment_status ?? (isHistoric ? 'paid' : 'unpaid')}, ${payment_date ?? null},
        ${reported_at ?? null}, ${isHistoric && payment_date ? payment_date : null}
      )
      RETURNING *`;
    // Mark asset as in_repair only for active (non-historic) tickets
    if (asset_id && !isHistoric) await sql`UPDATE assets SET status='in_repair' WHERE id=${asset_id}`.catch(()=>{});
    const ticket = (rows as any[])[0];
    // Activity log
    recordAssetActivity({
      ticket_id: ticket.id,
      asset_id: asset_id ?? null,
      action: 'created',
      actor_id: null,
      actor_name: created_by ?? employee_name ?? null,
      actor_role: 'employee',
      description: `Ticket opened: ${issue.trim()}${quoted_cost != null && quoted_cost !== '' ? ` · quoted ₹${Number(quoted_cost).toLocaleString('en-IN')}` : ''}`,
    });
    // Notifications
    notifyAdminsAndHR('repair_ticket_created', 'New Repair Ticket', `${employee_name ?? 'An employee'}'s laptop reported for repair: ${issue.trim().slice(0, 60)}${issue.length > 60 ? '…' : ''}`).catch(()=>{});
    if (employee_id) notifyEmployeeUser(employee_id, 'repair_ticket_created', 'Repair Ticket Logged', `Your laptop has been logged for repair. Issue: ${issue.trim().slice(0, 60)}${issue.length > 60 ? '…' : ''}`).catch(()=>{});
    res.status(201).json(ticket);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Status transition + edits
app.patch('/api/repair-tickets/:id', async (req, res) => {
  try {
    const { status, asset_id, laptop_info, vendor_id, issue, quoted_cost, final_cost, payment_mode, payment_date, notes, updated_by_role, actor_id, actor_name } = req.body;
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

    // Activity log — emit one entry per field that actually changed
    const actor = {
      actor_id:   actor_id ?? null,
      actor_name: actor_name ?? null,
      actor_role: updated_by_role ?? null,
    };
    const wasN = (v: any) => v === null || v === undefined || v === '' ? null : String(v);
    if (status && status !== t.status) {
      await recordAssetActivity({
        ticket_id: updated.id, asset_id: updated.asset_id, action: 'status_change',
        ...actor,
        before_value: t.status, after_value: newStatus,
        description: `Status changed from ${t.status} to ${newStatus}`,
      });
    }
    if (quoted_cost !== undefined && wasN(t.quoted_cost) !== wasN(quoted_cost)) {
      await recordAssetActivity({
        ticket_id: updated.id, action: 'cost_update', ...actor,
        before_value: wasN(t.quoted_cost), after_value: wasN(quoted_cost),
        description: `Quoted cost ${t.quoted_cost == null ? '—' : `₹${Number(t.quoted_cost).toLocaleString('en-IN')}`} → ${quoted_cost == null || quoted_cost === '' ? '—' : `₹${Number(quoted_cost).toLocaleString('en-IN')}`}`,
      });
    }
    if (final_cost !== undefined && wasN(t.final_cost) !== wasN(final_cost)) {
      await recordAssetActivity({
        ticket_id: updated.id, action: 'cost_update', ...actor,
        before_value: wasN(t.final_cost), after_value: wasN(final_cost),
        description: `Final cost ${t.final_cost == null ? '—' : `₹${Number(t.final_cost).toLocaleString('en-IN')}`} → ${final_cost == null || final_cost === '' ? '—' : `₹${Number(final_cost).toLocaleString('en-IN')}`}`,
      });
    }
    if (vendor_id !== undefined && wasN(t.vendor_id) !== wasN(vendor_id)) {
      await recordAssetActivity({
        ticket_id: updated.id, action: 'vendor_change', ...actor,
        before_value: wasN(t.vendor_id), after_value: wasN(vendor_id),
        description: `Vendor assignment changed`,
      });
    }
    if (payment_mode !== undefined && wasN(t.payment_mode) !== wasN(payment_mode)) {
      await recordAssetActivity({
        ticket_id: updated.id, action: 'payment_update', ...actor,
        before_value: wasN(t.payment_mode), after_value: wasN(payment_mode),
        description: `Payment mode set to ${payment_mode || '—'}`,
      });
    }
    if (notes !== undefined && (t.notes ?? '') !== (notes ?? '')) {
      await recordAssetActivity({
        ticket_id: updated.id, action: 'notes_update', ...actor,
        description: notes ? `Notes updated: ${String(notes).slice(0, 120)}` : 'Notes cleared',
      });
    }

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
    const { approved_by, actor_id, actor_role } = req.body;
    const pre = await sql`SELECT status FROM repair_tickets WHERE id=${req.params.id}` as any[];
    const rows = await sql`UPDATE repair_tickets SET status='paid', payment_status='paid', approved_by=${approved_by ?? null}, approved_at=NOW(), paid_at=NOW(), updated_at=NOW() WHERE id=${req.params.id} RETURNING *` as any[];
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const t = rows[0];
    await recordAssetActivity({
      ticket_id: t.id, asset_id: t.asset_id, action: 'approved',
      actor_id: actor_id ?? null, actor_name: approved_by ?? null, actor_role: actor_role ?? 'admin',
      before_value: pre[0]?.status, after_value: 'paid',
      description: `Approved & paid · ₹${Number(t.final_cost ?? t.quoted_cost ?? 0).toLocaleString('en-IN')}`,
    });
    if (t.asset_id) await sql`UPDATE assets SET status='active' WHERE id=${t.asset_id}`.catch(()=>{});
    if (t.employee_id) notifyEmployeeUser(t.employee_id, 'repair_paid', 'Laptop Repair Update', `Your laptop repair payment has been approved and marked as paid.`).catch(()=>{});
    notifyAdminsAndHR('repair_paid', 'Repair Payment Approved', `${t.employee_name}'s repair (₹${Number(t.final_cost ?? 0).toLocaleString('en-IN')}) approved & paid.`).catch(()=>{});
    res.json(t);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Admin reject — moves awaiting_approval → returned (HR can retry with revised cost)
app.patch('/api/repair-tickets/:id/reject', async (req, res) => {
  try {
    const { rejected_by, rejection_reason, actor_id, actor_role } = req.body;
    const pre = await sql`SELECT status FROM repair_tickets WHERE id=${req.params.id}` as any[];
    const rows = await sql`UPDATE repair_tickets SET status='returned', rejected_by=${rejected_by ?? null}, rejected_at=NOW(), rejection_reason=${rejection_reason ?? null}, requires_approval=FALSE, updated_at=NOW() WHERE id=${req.params.id} RETURNING *` as any[];
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    const t = rows[0];
    await recordAssetActivity({
      ticket_id: t.id, asset_id: t.asset_id, action: 'rejected',
      actor_id: actor_id ?? null, actor_name: rejected_by ?? null, actor_role: actor_role ?? 'admin',
      before_value: pre[0]?.status, after_value: 'returned',
      description: `Payment rejected${rejection_reason ? ` — ${rejection_reason}` : ''}`,
    });
    notifyAdminsAndHR('repair_rejected', 'Repair Payment Rejected', `${t.employee_name}'s repair payment was rejected by ${rejected_by}.${rejection_reason ? ' Reason: ' + rejection_reason : ''}`).catch(()=>{});
    res.json(t);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Admin/HR adds a free-text log entry to a ticket (no state change, just a note)
app.post('/api/repair-tickets/:id/note', async (req, res) => {
  try {
    const { note, actor_id, actor_name, actor_role } = req.body;
    if (!note?.trim()) return res.status(400).json({ error: 'note is required' });
    const rows = await sql`SELECT id, asset_id FROM repair_tickets WHERE id=${req.params.id}` as any[];
    if (!rows.length) return res.status(404).json({ error: 'Ticket not found' });
    await recordAssetActivity({
      ticket_id: rows[0].id, asset_id: rows[0].asset_id, action: 'note',
      actor_id: actor_id ?? null, actor_name: actor_name ?? null, actor_role: actor_role ?? null,
      description: note.trim(),
    });
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Activity log for a single ticket — admin/HR view only (frontend gates this)
app.get('/api/repair-tickets/:id/activity', async (req, res) => {
  try {
    const rows = await sql`
      SELECT * FROM asset_activity_log
      WHERE ticket_id=${req.params.id}
      ORDER BY created_at ASC`;
    res.json(rows);
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
    const { name, email, password, role, department, designation, avatar, active, employee_id_ref } = req.body;
    // Only touch the password column when an explicit password is provided.
    // Callers that just want to update profile fields (department, designation,
    // etc.) shouldn't have to re-supply the user's password — and they can't
    // because GET /api/users never returns it.
    // employee_id_ref is also optional — only updated if explicitly provided
    // (callers fixing a stale linkage send it; routine profile saves omit it).
    const updatePassword = !!password;
    const updateRef = employee_id_ref !== undefined;
    let rows: any[];
    if (updatePassword && updateRef) {
      rows = await sql`
        UPDATE app_users SET name=${name}, email=${email},
          password=${password.startsWith('$2') ? password : await bcrypt.hash(password, 10)},
          role=${role}, department=${department}, designation=${designation},
          avatar=${avatar}, active=${active}, employee_id_ref=${employee_id_ref || null}
        WHERE id=${req.params.id}
        RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    } else if (updatePassword) {
      rows = await sql`
        UPDATE app_users SET name=${name}, email=${email},
          password=${password.startsWith('$2') ? password : await bcrypt.hash(password, 10)},
          role=${role}, department=${department}, designation=${designation},
          avatar=${avatar}, active=${active}
        WHERE id=${req.params.id}
        RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    } else if (updateRef) {
      rows = await sql`
        UPDATE app_users SET name=${name}, email=${email}, role=${role},
          department=${department}, designation=${designation},
          avatar=${avatar}, active=${active}, employee_id_ref=${employee_id_ref || null}
        WHERE id=${req.params.id}
        RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    } else {
      rows = await sql`
        UPDATE app_users SET name=${name}, email=${email}, role=${role},
          department=${department}, designation=${designation},
          avatar=${avatar}, active=${active}
        WHERE id=${req.params.id}
        RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    }
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
    // LEFT JOIN total approved hours per project so the list can show
    // consumed-vs-cap progress without an extra round trip.
    let rows: any[];
    if (status && type) {
      rows = await sql`
        SELECT p.*, COALESCE(c.consumed, 0)::numeric AS consumed_hours_total
        FROM projects p
        LEFT JOIN (SELECT project_id, SUM(hours_logged) AS consumed FROM hour_logs WHERE status='approved' GROUP BY project_id) c ON c.project_id = p.id
        WHERE p.status=${status} AND p.project_type=${type} ORDER BY p.name ASC`;
    } else if (status) {
      rows = await sql`
        SELECT p.*, COALESCE(c.consumed, 0)::numeric AS consumed_hours_total
        FROM projects p
        LEFT JOIN (SELECT project_id, SUM(hours_logged) AS consumed FROM hour_logs WHERE status='approved' GROUP BY project_id) c ON c.project_id = p.id
        WHERE p.status=${status} ORDER BY p.name ASC`;
    } else if (type) {
      rows = await sql`
        SELECT p.*, COALESCE(c.consumed, 0)::numeric AS consumed_hours_total
        FROM projects p
        LEFT JOIN (SELECT project_id, SUM(hours_logged) AS consumed FROM hour_logs WHERE status='approved' GROUP BY project_id) c ON c.project_id = p.id
        WHERE p.project_type=${type} ORDER BY p.name ASC`;
    } else {
      rows = await sql`
        SELECT p.*, COALESCE(c.consumed, 0)::numeric AS consumed_hours_total
        FROM projects p
        LEFT JOIN (SELECT project_id, SUM(hours_logged) AS consumed FROM hour_logs WHERE status='approved' GROUP BY project_id) c ON c.project_id = p.id
        ORDER BY p.status='archived', p.name ASC`;
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
      status, flag, flag_reason, notes, created_by, total_hours_cap, billing_source,
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const capVal = total_hours_cap === '' || total_hours_cap === null || total_hours_cap === undefined ? null : Number(total_hours_cap);
    if (capVal !== null && (Number.isNaN(capVal) || capVal < 0)) {
      return res.status(400).json({ error: 'total_hours_cap must be a non-negative number' });
    }
    const id = newId('proj');
    const rows = await sql`
      INSERT INTO projects (id, name, client_name, project_type, dashboard_url,
        project_reporting_id, project_reporting_name, project_lead_id, project_lead_name,
        status, flag, flag_reason, notes, created_by, total_hours_cap, billing_source)
      VALUES (${id}, ${name}, ${client_name ?? null}, ${project_type ?? null}, ${dashboard_url ?? null},
        ${project_reporting_id ?? null}, ${project_reporting_name ?? null},
        ${project_lead_id ?? null}, ${project_lead_name ?? null},
        ${status ?? 'active'}, ${flag ?? null}, ${flag_reason ?? null}, ${notes ?? null}, ${created_by ?? null},
        ${capVal}, ${billing_source ?? 'direct'})
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
      status, flag, flag_reason, notes, total_hours_cap, billing_source,
    } = req.body;
    // Detect status flipping to 'archived' so we can clean up future-month
    // assignments (planning should stop from that day onward).
    const wasActive = (await sql`SELECT status FROM projects WHERE id=${req.params.id}` as any[])[0]?.status;
    const isArchiving = status === 'archived' && wasActive !== 'archived';
    // Only update cap if explicitly provided in the body — callers that omit it
    // keep the existing value.
    const updateCap = total_hours_cap !== undefined;
    const capVal = total_hours_cap === '' || total_hours_cap === null ? null : Number(total_hours_cap);
    if (updateCap && capVal !== null && (Number.isNaN(capVal) || capVal < 0)) {
      return res.status(400).json({ error: 'total_hours_cap must be a non-negative number' });
    }
    const updateBilling = billing_source !== undefined;
    const rows = updateCap
      ? await sql`
        UPDATE projects SET
          name=${name}, client_name=${client_name ?? null}, project_type=${project_type ?? null},
          dashboard_url=${dashboard_url ?? null},
          project_reporting_id=${project_reporting_id ?? null}, project_reporting_name=${project_reporting_name ?? null},
          project_lead_id=${project_lead_id ?? null}, project_lead_name=${project_lead_name ?? null},
          status=${status ?? 'active'}, flag=${flag ?? null}, flag_reason=${flag_reason ?? null},
          notes=${notes ?? null},
          total_hours_cap=${capVal},
          billing_source=COALESCE(${updateBilling ? (billing_source || 'direct') : null}, billing_source)
        WHERE id=${req.params.id} RETURNING *`
      : await sql`
        UPDATE projects SET
          name=${name}, client_name=${client_name ?? null}, project_type=${project_type ?? null},
          dashboard_url=${dashboard_url ?? null},
          project_reporting_id=${project_reporting_id ?? null}, project_reporting_name=${project_reporting_name ?? null},
          project_lead_id=${project_lead_id ?? null}, project_lead_name=${project_lead_name ?? null},
          status=${status ?? 'active'}, flag=${flag ?? null}, flag_reason=${flag_reason ?? null},
          notes=${notes ?? null},
          billing_source=COALESCE(${updateBilling ? (billing_source || 'direct') : null}, billing_source)
        WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    if (isArchiving) {
      await dismissFutureAssignments(req.params.id);
    }
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// When a project is archived we stop further planning against it: drop
// assignment rows for the current month and all future months. Past months
// are kept so historical reporting still works, and any hour_logs already
// recorded against the project remain intact (the work happened).
async function dismissFutureAssignments(projectId: string) {
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear();
  await sql`
    DELETE FROM project_assignments
    WHERE project_id = ${projectId}
      AND (year > ${y} OR (year = ${y} AND month >= ${m}))`;
}

app.delete('/api/projects/:id', async (req, res) => {
  try {
    // Soft delete: mark archived; preserves history of hour logs
    const rows = await sql`UPDATE projects SET status='archived' WHERE id=${req.params.id} RETURNING id, status`;
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    await dismissFutureAssignments(req.params.id);
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
             au.last_admin_editor,
             -- Fallback: if the weekly work_description is empty but the
             -- employee wrote per-day notes, stitch them together at query
             -- time so the Approvals UI never shows "—" when there IS data.
             -- Format: "DD: note · DD: note" in date order.
             COALESCE(
               NULLIF(TRIM(hl.work_description), ''),
               (
                 SELECT STRING_AGG(
                   TO_CHAR(d.log_date::date, 'DD') || ': ' || TRIM(d.notes),
                   ' · ' ORDER BY d.log_date
                 )
                 FROM hour_log_days d
                 WHERE d.assignment_id = hl.assignment_id
                   AND d.week_num = hl.week_num
                   AND d.notes IS NOT NULL AND LENGTH(TRIM(d.notes)) > 0
               )
             ) AS effective_description,
             -- Structured per-day data so the reviewer can see each day's
             -- date + hours + note as its own row instead of a stitched
             -- string. Empty when the employee didn't use the daily flow.
             (
               SELECT JSON_AGG(JSON_BUILD_OBJECT(
                 'date', d.log_date,
                 'hours', d.hours,
                 'notes', d.notes
               ) ORDER BY d.log_date)
               FROM hour_log_days d
               WHERE d.assignment_id = hl.assignment_id
                 AND d.week_num = hl.week_num
             ) AS day_notes
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
  // Aggregate day-level notes into a single weekly description, in date order.
  // This keeps work_description in sync with what the employee actually wrote
  // each day — otherwise the My Hours grid + Approval table would show NULL
  // even though the employee filled out per-day notes.
  const dayNoteRows = await sql`
    SELECT log_date, notes FROM hour_log_days
    WHERE assignment_id=${assignment_id} AND week_num=${week_num}
      AND notes IS NOT NULL AND length(trim(notes)) > 0
    ORDER BY log_date ASC`;
  const aggregatedDesc = (dayNoteRows as any[])
    .map(d => `${String(d.log_date).slice(0, 10).slice(8)}: ${d.notes.trim()}`)
    .join(' · ') || null;
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
        work_description=${aggregatedDesc},
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
      ${r.month}, ${r.year}, ${week_num}, ${Number(r.total)}, ${aggregatedDesc}, 'pending')`;
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
    const project_id = (req.query.project_id as string) || null;
    const rows = await sql`
      SELECT d.*, p.name AS project_name, p.client_name AS project_client_name
      FROM hour_log_days d
      JOIN projects p ON p.id = d.project_id
      WHERE (${month}::int IS NULL OR d.month=${month})
        AND (${year}::int  IS NULL OR d.year=${year})
        AND (${employee_id}::text IS NULL OR d.employee_id=${employee_id})
        AND (${assignment_id}::text IS NULL OR d.assignment_id=${assignment_id})
        AND (${project_id}::text IS NULL OR d.project_id=${project_id})
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

// ── Direct staff utilization (role-scoped, cost-stripped) ───────────────
// Same shape as the finance dashboard's utilization rows, but exposed to
// coordinator / HR / reporting managers without the salary / rate / bench-
// cost fields. Lets managers see their team's utilization and lets coord
// see everyone — but neither can derive how much someone earns.
//
// Scope:
//   - admin            → everyone, salary/rate retained (kept for parity)
//   - hr_manager       → everyone, cost fields stripped
//   - project_coordinator → everyone, cost fields stripped
//   - employee (manager) → their reporting sub-tree only, cost fields stripped
//   - anyone else      → 403
app.get('/api/hours-utilization', async (req, res) => {
  try {
    await runStartupMigrations();
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();

    // Identify caller
    const userId = req.header('x-user-id') || (req.query.__uid as string);
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    const userRows = await sql`SELECT id, role, employee_id_ref, active FROM app_users WHERE id=${userId} LIMIT 1`;
    const u = (userRows as any[])[0];
    if (!u || u.active !== true) return res.status(401).json({ error: 'Not authenticated' });

    const isAdmin = u.role === 'admin';
    const isAdminish = isAdmin || u.role === 'hr_manager' || u.role === 'project_coordinator';

    // Resolve viewer's employee.id for the manager case
    let viewerEmpId: string | null = null;
    if (u.employee_id_ref) {
      const er = await sql`SELECT id FROM employees WHERE employee_id=${u.employee_id_ref} LIMIT 1`;
      viewerEmpId = (er as any[])[0]?.id ?? null;
    }

    // Build the visible-employee scope. Admin-ish roles see everyone (null
    // sentinel). Regular employees only get access if they have direct reports;
    // we then return their full sub-tree.
    let visibleIds: Set<string> | null = null;
    if (!isAdminish) {
      if (!viewerEmpId) return res.status(403).json({ error: 'Not authorized' });
      const subTree = await sql`
        WITH RECURSIVE chain AS (
          SELECT id FROM employees WHERE reporting_manager_id = ${viewerEmpId}
          UNION ALL
          SELECT e.id FROM employees e JOIN chain c ON e.reporting_manager_id = c.id
        )
        SELECT id FROM chain`;
      const ids = (subTree as any[]).map(r => r.id);
      if (ids.length === 0) return res.json({ month, year, employees: [], scope: 'team', total: { allocated: 0, capacity: 0, bench: 0, utilization: 0, headcount: 0 } });
      visibleIds = new Set(ids);
    }

    const model = await finComputeMonth(month, year);
    let rows = (model.employeeRows as any[]).filter(e => e.cost_type === 'direct');
    if (visibleIds) rows = rows.filter(e => visibleIds!.has(e.id));

    // Strip cost / salary for everyone except admin.
    if (!isAdmin) {
      rows = rows.map(e => {
        const { salary, rate, allocatedCost, benchCost, ...rest } = e;
        return rest;
      });
    }

    // Aggregate
    const totalAlloc = rows.reduce((s, e) => s + Number(e.allocatedHours || 0), 0);
    const totalCap = rows.reduce((s, e) => s + Number(e.capacity || 0), 0);
    const totalBench = rows.reduce((s, e) => s + Number(e.benchHours || 0), 0);
    res.json({
      month, year,
      scope: isAdminish ? 'org' : 'team',
      employees: rows.sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0)),
      total: {
        allocated: totalAlloc,
        capacity: totalCap,
        bench: totalBench,
        utilization: totalCap > 0 ? totalAlloc / totalCap : 0,
        headcount: rows.length,
      },
    });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Daily-log compliance ─────────────────────────────────────────────────
// GET /api/hours-compliance?date=YYYY-MM-DD&manager_id=<optional>
// Returns:
//   not_logged: employees with at least one project assignment this month
//               who have logged ZERO hours for the given date.
//   pending:    hour_logs in 'pending' state grouped by reviewer, with the
//               oldest-pending-days metric so it's clear who's been sitting
//               on logs the longest.
// If manager_id is provided, not_logged is scoped to that manager's full
// sub-tree (recursive). Without it, the response is org-wide.
app.get('/api/hours-compliance', async (req, res) => {
  try {
    await runStartupMigrations();
    const dateStr = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const date = new Date(dateStr + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();
    const managerId = (req.query.manager_id as string) || null;

    // Sub-tree employee ids when scoping to a manager — direct reports + the
    // entire chain beneath them.
    let scopeIds: string[] | null = null;
    if (managerId) {
      const rows = await sql`
        WITH RECURSIVE team AS (
          SELECT id FROM employees WHERE reporting_manager_id = ${managerId}
          UNION ALL
          SELECT e.id FROM employees e JOIN team t ON e.reporting_manager_id = t.id
        )
        SELECT id FROM team`;
      scopeIds = (rows as any[]).map(r => r.id);
      if (scopeIds.length === 0) scopeIds = ['__none__']; // ensure IN clause is non-empty
    }

    // Eligible = anyone with at least one assignment this month. Sub-tree
    // filter applied via array overlap when scopeIds is set.
    const eligible = await sql`
      SELECT DISTINCT e.id, e.name, e.designation, e.department,
             e.reporting_manager_id, m.name AS reporting_manager_name,
             (SELECT COUNT(*) FROM project_assignments pa
                WHERE pa.employee_id = e.id AND pa.month=${month} AND pa.year=${year}) AS assignment_count
      FROM employees e
      LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.status='active'
        AND EXISTS (
          SELECT 1 FROM project_assignments pa
          WHERE pa.employee_id = e.id AND pa.month=${month} AND pa.year=${year}
        )
        AND (${scopeIds}::text[] IS NULL OR e.id = ANY(${scopeIds}::text[]))
      ORDER BY e.name`;

    // Who DID log on the given date — sum hours from hour_log_days.
    const logged = await sql`
      SELECT employee_id, SUM(COALESCE(hours, 0))::numeric AS hours_today
      FROM hour_log_days
      WHERE log_date = ${dateStr}
      GROUP BY employee_id`;
    const loggedMap = new Map<string, number>();
    for (const r of logged as any[]) loggedMap.set(r.employee_id, Number(r.hours_today));

    const notLogged = (eligible as any[]).filter(e => !((loggedMap.get(e.id) ?? 0) > 0));

    // Pending approvals — grouped by the reviewer (project_reporting_id on
    // the project). Includes age of oldest pending so a triage view is easy.
    const pending = await sql`
      SELECT p.project_reporting_id AS reviewer_id,
             p.project_reporting_name AS reviewer_name,
             COUNT(*)::int AS log_count,
             COALESCE(SUM(hl.hours_logged), 0)::numeric AS total_hours,
             MIN(hl.submitted_at) AS oldest_pending_at
      FROM hour_logs hl
      JOIN projects p ON p.id = hl.project_id
      WHERE hl.status = 'pending'
        AND (${scopeIds}::text[] IS NULL OR hl.employee_id = ANY(${scopeIds}::text[]))
      GROUP BY p.project_reporting_id, p.project_reporting_name
      ORDER BY oldest_pending_at ASC`;

    // Pending logs per submitting employee — same scope rules.
    const pendingByEmployee = await sql`
      SELECT hl.employee_id, hl.employee_name,
             COUNT(*)::int AS log_count,
             COALESCE(SUM(hl.hours_logged), 0)::numeric AS total_hours,
             MIN(hl.submitted_at) AS oldest_pending_at
      FROM hour_logs hl
      WHERE hl.status = 'pending'
        AND (${scopeIds}::text[] IS NULL OR hl.employee_id = ANY(${scopeIds}::text[]))
      GROUP BY hl.employee_id, hl.employee_name
      ORDER BY total_hours DESC`;

    res.json({
      date: dateStr,
      month, year,
      eligible_count: (eligible as any[]).length,
      not_logged_count: notLogged.length,
      logged_count: (eligible as any[]).length - notLogged.length,
      not_logged: notLogged.map(e => ({
        employee_id: e.id,
        employee_name: e.name,
        designation: e.designation,
        department: e.department,
        reporting_manager_id: e.reporting_manager_id,
        reporting_manager_name: e.reporting_manager_name,
        assignment_count: Number(e.assignment_count),
      })),
      pending_by_reviewer: (pending as any[]).map(r => ({
        reviewer_id: r.reviewer_id,
        reviewer_name: r.reviewer_name || 'Unassigned',
        log_count: Number(r.log_count),
        total_hours: Number(r.total_hours),
        oldest_pending_at: r.oldest_pending_at,
      })),
      pending_by_employee: (pendingByEmployee as any[]).map(r => ({
        employee_id: r.employee_id,
        employee_name: r.employee_name,
        log_count: Number(r.log_count),
        total_hours: Number(r.total_hours),
        oldest_pending_at: r.oldest_pending_at,
      })),
    });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ════════════════════════════════════════════════════════════════════════
// ── Finance / CFO module (admin-only) ───────────────────────────────────
// ════════════════════════════════════════════════════════════════════════
const FIN_DEFAULT_SETTINGS = {
  working_hours_per_month: 176,
  overhead_method: 'direct_hours',
  currency: '₹',
  include_bench_in_overhead: false,
};

async function finGetSettings() {
  const row = (await sql`SELECT * FROM fin_settings WHERE id=1`)[0] as any;
  if (!row) return { ...FIN_DEFAULT_SETTINGS };
  return {
    working_hours_per_month: Number(row.working_hours_per_month) || 176,
    overhead_method: row.overhead_method || 'direct_hours',
    currency: row.currency || '₹',
    include_bench_in_overhead: !!row.include_bench_in_overhead,
  };
}

// The CFO engine for a single month — mirrors the standalone finance app.
async function finComputeMonth(month: number, year: number) {
  const settings = await finGetSettings();
  const defCap = settings.working_hours_per_month;

  const employees = (await sql`
    SELECT e.id, e.name, e.designation, e.department, e.reporting_manager_id,
           COALESCE(e.salary,0) AS salary, m.cost_type, m.capacity_hours
    FROM fin_employee_meta m JOIN employees e ON e.id = m.employee_id
    WHERE m.active = TRUE`) as any[];
  const projects = (await sql`SELECT id, name, client_name, project_lead_id, project_reporting_id FROM projects WHERE status='active'`) as any[];
  const revenues = (await sql`SELECT * FROM fin_project_revenue WHERE month=${month} AND year=${year}`) as any[];
  const assignments = (await sql`
    SELECT project_id, employee_id, COALESCE(monthly_hours,0) AS hours
    FROM project_assignments WHERE month=${month} AND year=${year}`) as any[];
  const otherCosts = (await sql`
    SELECT id, name, amount, category FROM fin_other_costs
    WHERE month=${month} AND year=${year} ORDER BY amount DESC`) as any[];
  // Per-project direct expenses (outsourced work, content fees, ads, etc.)
  const projExpenses = (await sql`
    SELECT id, project_id, vendor, description, amount, category, created_by, created_by_role, created_at
    FROM fin_project_expenses
    WHERE month=${month} AND year=${year}`) as any[];
  const projExpenseByProject = new Map<string, number>();
  for (const e of projExpenses) {
    projExpenseByProject.set(e.project_id, (projExpenseByProject.get(e.project_id) || 0) + Number(e.amount));
  }

  // Per-project invoice totals — always in INR (home currency). USD/foreign
  // amounts were converted at the invoice's fx_rate when raised, then stored
  // in amount_invoiced_inr. `realized` is the hybrid revenue figure that
  // drives the P&L: cleared invoices count at amount_received (which is also
  // INR), pending invoices count at amount_invoiced_inr (expected revenue).
  // Variance between billed-INR and received-INR (Upwork fees, TDS, FX swing)
  // immediately hits net profit on clearance.
  const invoiceAgg = (await sql`
    SELECT project_id,
      SUM(COALESCE(amount_invoiced_inr, amount_invoiced))::numeric AS invoiced,
      SUM(CASE WHEN status='cleared' THEN COALESCE(amount_received, 0) ELSE 0 END)::numeric AS received,
      SUM(CASE WHEN status='cleared' THEN COALESCE(amount_received, 0)
                ELSE COALESCE(amount_invoiced_inr, amount_invoiced) END)::numeric AS realized,
      COUNT(*) FILTER (WHERE status='pending')::int AS pending_count,
      COUNT(*) FILTER (WHERE status='cleared')::int AS cleared_count,
      COUNT(*)::int AS invoice_count
    FROM fin_project_invoices
    WHERE month=${month} AND year=${year} AND status <> 'cancelled'
    GROUP BY project_id`) as any[];
  const invoiceByProj = new Map<string, any>();
  for (const i of invoiceAgg) invoiceByProj.set(i.project_id, i);

  const empById = new Map(employees.map((e) => [e.id, e]));
  const projIds = new Set(projects.map((p) => p.id));
  const revByProj = new Map(revenues.map((r) => [r.project_id, r]));

  const capOf = (e: any) => { const c = Number(e.capacity_hours); return c > 0 ? c : defCap; };
  const rateOf = (e: any) => { const c = capOf(e); return c > 0 ? Number(e.salary) / c : 0; };
  const revenueOf = (p: any) => {
    // Invoices win when present. Use the *realized* figure — cleared invoices
    // contribute their received amount, pending invoices their invoiced amount.
    // This means cleared shortfalls (TDS, FX, partial pay) immediately hit
    // gross/net profit instead of hiding behind the accrual number.
    const inv = invoiceByProj.get(p.id);
    if (inv && Number(inv.invoiced) > 0) return Number(inv.realized);
    const r = revByProj.get(p.id);
    if (!r) return 0;
    // Billing Setup (Upwork): mirror invoice behavior — cleared rows count at
    // received_inr (real money), pending rows at revenue_inr (invoiced).
    // received_inr was locked at clearance using the FX rate of that day, so
    // variance vs invoiced flows through to net profit on clearance.
    if (r.status === 'cleared' && r.received_inr != null) return Number(r.received_inr);
    if (r.revenue_inr != null) return Number(r.revenue_inr);
    return r.billing_type === 'hourly' ? Number(r.hourly_rate) * Number(r.billable_hours) : Number(r.fixed_amount);
  };

  const activeAllocs = assignments.filter(
    (a) => empById.has(a.employee_id) && projIds.has(a.project_id) && empById.get(a.employee_id).cost_type === 'direct'
  );
  const allocByEmp = new Map<string, number>();
  for (const a of activeAllocs) allocByEmp.set(a.employee_id, (allocByEmp.get(a.employee_id) || 0) + Number(a.hours));

  // Resolve manager name per employee (their reporting manager is another row
  // in the same employees array). Used by the dashboard to group people by
  // who they report to — that's how "team" is interpreted across the app.
  const empById2 = new Map(employees.map((e) => [e.id, e]));
  const managerNameOf = (e: any) => {
    if (!e.reporting_manager_id) return null;
    return empById2.get(e.reporting_manager_id)?.name ?? null;
  };

  const employeeRows = employees.map((e) => {
    const rate = rateOf(e), capacity = capOf(e), isDirect = e.cost_type === 'direct';
    const allocated = isDirect ? (allocByEmp.get(e.id) || 0) : 0;
    const bench = isDirect ? Math.max(capacity - allocated, 0) : 0;
    return {
      id: e.id, name: e.name, designation: e.designation, department: e.department, cost_type: e.cost_type,
      reporting_manager_id: e.reporting_manager_id ?? null,
      reporting_manager_name: managerNameOf(e),
      salary: Number(e.salary), rate, capacity, allocatedHours: allocated, benchHours: bench,
      allocatedCost: isDirect ? rate * allocated : 0, benchCost: isDirect ? rate * bench : 0,
      utilization: isDirect && capacity > 0 ? allocated / capacity : null,
    };
  });

  const indirectSalaries = employees.filter((e) => e.cost_type === 'indirect').reduce((s, e) => s + Number(e.salary), 0);
  const supervisors = employees.filter((e) => e.cost_type === 'supervisor');
  const supervisorSalariesTotal = supervisors.reduce((s, e) => s + Number(e.salary), 0);
  const otherCostTotal = otherCosts.reduce((s, c) => s + Number(c.amount), 0);
  const benchCost = employeeRows.reduce((s, e) => s + e.benchCost, 0);

  // Pre-compute per-project direct hours / cost / team (direct staff only).
  const directHoursByProject = new Map<string, number>();
  const directCostByProject = new Map<string, number>();
  const teamByProject = new Map<string, any[]>();
  for (const p of projects) {
    const allocs = activeAllocs.filter((a) => a.project_id === p.id);
    const team = allocs.map((a) => {
      const e = empById.get(a.employee_id); const rate = rateOf(e);
      return { id: e.id, name: e.name, designation: e.designation, hours: Number(a.hours), rate, cost: rate * Number(a.hours) };
    }).sort((x, y) => y.cost - x.cost);
    directHoursByProject.set(p.id, team.reduce((s, t) => s + t.hours, 0));
    directCostByProject.set(p.id, team.reduce((s, t) => s + t.cost, 0));
    teamByProject.set(p.id, team);
  }

  // Which managers does each project's assigned direct staff report to?
  const managersByProject = new Map<string, Set<string>>();
  for (const a of activeAllocs) {
    const mgr = empById.get(a.employee_id)?.reporting_manager_id;
    if (!mgr) continue;
    if (!managersByProject.has(a.project_id)) managersByProject.set(a.project_id, new Set());
    managersByProject.get(a.project_id)!.add(mgr);
  }

  // ── Supervision allocation ──
  // Each supervisor's full salary is spread ONLY across the projects they run
  // (they're the project lead/reporting owner, OR their reports are assigned there),
  // proportional to those projects' direct hours. Supervisors with no managed
  // project this month fall back into the general overhead pool so nothing is lost.
  const supervisionByProject = new Map<string, number>();
  const supervisorsByProject = new Map<string, string[]>();
  // Per-project list of supervisors with the amount each one contributes to
  // that project's supervision cost — needed for drill-down UI.
  const supervisorBreakdownByProject = new Map<string, Array<{ id: string; name: string; salary: number; share: number; amount: number }>>();
  const managedCountBySupervisor = new Map<string, number>();
  let unallocatedSupervision = 0;
  for (const s of supervisors) {
    const managed = projects.filter((p) =>
      p.project_lead_id === s.id || p.project_reporting_id === s.id || managersByProject.get(p.id)?.has(s.id)
    ).map((p) => p.id);
    managedCountBySupervisor.set(s.id, managed.length);
    const salary = Number(s.salary);
    if (managed.length === 0) { unallocatedSupervision += salary; continue; }
    const totalMgHours = managed.reduce((sum, pid) => sum + (directHoursByProject.get(pid) || 0), 0);
    for (const pid of managed) {
      const share = totalMgHours > 0 ? (directHoursByProject.get(pid) || 0) / totalMgHours : 1 / managed.length;
      const amount = salary * share;
      supervisionByProject.set(pid, (supervisionByProject.get(pid) || 0) + amount);
      if (!supervisorsByProject.has(pid)) supervisorsByProject.set(pid, []);
      supervisorsByProject.get(pid)!.push(s.name);
      if (!supervisorBreakdownByProject.has(pid)) supervisorBreakdownByProject.set(pid, []);
      supervisorBreakdownByProject.get(pid)!.push({ id: s.id, name: s.name, salary, share, amount });
    }
  }

  // attach managed-project count onto supervisor employee rows
  for (const er of employeeRows) {
    (er as any).managedProjects = er.cost_type === 'supervisor' ? (managedCountBySupervisor.get(er.id) || 0) : 0;
  }

  const overheadPool = indirectSalaries + otherCostTotal + unallocatedSupervision + (settings.include_bench_in_overhead ? benchCost : 0);

  const totalDirectHours = activeAllocs.reduce((s, a) => s + Number(a.hours), 0);
  const totalRevenue = projects.reduce((s, p) => s + revenueOf(p), 0);
  const shareOf = (dh: number, rev: number) => {
    switch (settings.overhead_method) {
      case 'direct_hours': return totalDirectHours > 0 ? dh / totalDirectHours : 0;
      case 'revenue': return totalRevenue > 0 ? rev / totalRevenue : 0;
      case 'headcount': return projects.length > 0 ? 1 / projects.length : 0;
      default: return 0;
    }
  };

  const projectRows = projects.map((p) => {
    const team = teamByProject.get(p.id) || [];
    const directCost = directCostByProject.get(p.id) || 0;
    const directHours = directHoursByProject.get(p.id) || 0;
    const revenue = revenueOf(p);
    const projectExpenses = projExpenseByProject.get(p.id) || 0;
    // Gross profit now excludes outsourced project expenses too (they're direct
    // cost of delivery for this project, not org overhead).
    const grossProfit = revenue - directCost - projectExpenses;
    const overheadShare = shareOf(directHours, revenue);
    const overhead = overheadPool * overheadShare;
    const supervision = supervisionByProject.get(p.id) || 0;
    const netProfit = grossProfit - overhead - supervision;
    const r = revByProj.get(p.id);
    const inv = invoiceByProj.get(p.id);
    return {
      id: p.id, name: p.name, client_name: p.client_name,
      billing_type: r?.billing_type || 'fixed', hourly_rate: Number(r?.hourly_rate || 0),
      billable_hours: Number(r?.billable_hours || 0), fixed_amount: Number(r?.fixed_amount || 0),
      revenue, directCost, directHours, projectExpenses,
      invoiced: Number(inv?.invoiced || 0),
      received: Number(inv?.received || 0),
      pendingCount: Number(inv?.pending_count || 0),
      clearedCount: Number(inv?.cleared_count || 0),
      invoiceCount: Number(inv?.invoice_count || 0),
      grossProfit, grossMargin: revenue > 0 ? grossProfit / revenue : 0,
      overhead, supervision,
      supervisorNames: supervisorsByProject.get(p.id) || [],
      supervisorBreakdown: supervisorBreakdownByProject.get(p.id) || [],
      // Overhead allocation transparency — lets the drill-down show
      // "this project got X% of the ₹Y pool because <method> = Z"
      overheadShare,
      overheadMethod: settings.overhead_method,
      overheadPool,
      netProfit, netMargin: revenue > 0 ? netProfit / revenue : 0,
      effectiveCostPerHour: directHours > 0 ? directCost / directHours : 0,
      revenuePerHour: directHours > 0 ? revenue / directHours : 0, team,
    };
  }).sort((a, b) => b.netProfit - a.netProfit);

  const totalDirectCost = projectRows.reduce((s, p) => s + p.directCost, 0);
  const totalProjectExpenses = projectRows.reduce((s, p) => s + p.projectExpenses, 0);
  const grossProfit = totalRevenue - totalDirectCost - totalProjectExpenses;
  const netProfit = totalRevenue - totalDirectCost - totalProjectExpenses - benchCost - indirectSalaries - supervisorSalariesTotal - otherCostTotal;
  const totalSalary = employees.reduce((s, e) => s + Number(e.salary), 0);
  const totalCost = totalDirectCost + totalProjectExpenses + benchCost + indirectSalaries + supervisorSalariesTotal + otherCostTotal;
  const directEmps = employeeRows.filter((e) => e.cost_type === 'direct');
  const directCapacityHours = directEmps.reduce((s, e) => s + e.capacity, 0);
  const allocatedDirectHours = directEmps.reduce((s, e) => s + e.allocatedHours, 0);

  const deptMap = new Map<string, { headcount: number; salary: number }>();
  for (const e of employees) {
    const k = e.department || '—'; const v = deptMap.get(k) || { headcount: 0, salary: 0 };
    v.headcount++; v.salary += Number(e.salary); deptMap.set(k, v);
  }
  const byDept = [...deptMap.entries()].map(([department, v]) => ({ department, ...v })).sort((a, b) => b.salary - a.salary);

  return {
    month, year, settings,
    employeeRows, projectRows,
    otherCosts: otherCosts.map((c) => ({ id: c.id, name: c.name, amount: Number(c.amount), category: c.category })),
    byDept,
    totals: {
      revenue: totalRevenue, directCost: totalDirectCost,
      projectExpenses: totalProjectExpenses,
      // Invoice aggregates: invoiced is what was billed (accrual), received is
      // what's actually in the bank, pending is the gap. invoiced typically
      // equals totalRevenue when every project has invoices; differs only for
      // projects still relying on the legacy fin_project_revenue fallback.
      totalInvoiced: projectRows.reduce((s, p) => s + p.invoiced, 0),
      totalReceived: projectRows.reduce((s, p) => s + p.received, 0),
      totalPending: projectRows.reduce((s, p) => s + Math.max(p.invoiced - p.received, 0), 0),
      pendingInvoiceCount: projectRows.reduce((s, p) => s + p.pendingCount, 0),
      clearedInvoiceCount: projectRows.reduce((s, p) => s + p.clearedCount, 0),
      benchCost, indirectSalaries,
      supervisionCost: supervisorSalariesTotal, supervisorHeadcount: supervisors.length,
      otherCosts: otherCostTotal,
      overheadPool, grossProfit, grossMargin: totalRevenue > 0 ? grossProfit / totalRevenue : 0,
      netProfit, netMargin: totalRevenue > 0 ? netProfit / totalRevenue : 0, totalSalary, totalCost,
      directCapacityHours, allocatedDirectHours, utilization: directCapacityHours > 0 ? allocatedDirectHours / directCapacityHours : null,
      headcount: employees.length, directHeadcount: directEmps.length, indirectHeadcount: employees.length - directEmps.length,
      activeProjects: projects.length,
    },
  };
}

// GET /api/finance/dashboard?month=&year=
app.get('/api/finance/dashboard', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const month = Number(req.query.month), year = Number(req.query.year);
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    res.json(await finComputeMonth(month, year));
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Profitability Optimization (admin-only) ──────────────────────────────
// Builds three analytical views on top of finComputeMonth:
//   1. Bleed report — assignments ranked by monthly margin loss, each paired
//      with the best feasible swap candidate (an employee with spare capacity
//      whose margin on that project is better).
//   2. Margin matrix — every direct-staff × every active-project cell with
//      margin/h and hours, so the dashboard can render a heat-map sorted
//      seniors-down on rows and revenue-down on columns.
//   3. Leverage score — per-employee revenue-produced ÷ salary, with a
//      verdict bucket (great / ok / underused / bench).
app.get('/api/finance/optimization', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const threshold = Number(req.query.threshold) || 5000;  // rupees/mo minimum to surface a swap

    const model = await finComputeMonth(month, year);
    const directEmps = (model.employeeRows as any[]).filter(e => e.cost_type === 'direct');
    const projects = (model.projectRows as any[]).filter(p => Number(p.revenue || 0) > 0 || Number(p.directHours || 0) > 0);

    const empById = new Map(directEmps.map((e: any) => [e.id, e]));
    const projById = new Map(projects.map((p: any) => [p.id, p]));

    // Raw assignments — needed for finding swap candidates (their current load)
    const allAssignments = (await sql`
      SELECT id, project_id, employee_id, employee_name, monthly_hours
      FROM project_assignments
      WHERE month=${month} AND year=${year}`) as any[];

    // Total hours currently allocated per employee — used to gate swap suggestions
    const hoursByEmp = new Map<string, number>();
    for (const a of allAssignments) {
      hoursByEmp.set(a.employee_id, (hoursByEmp.get(a.employee_id) || 0) + Number(a.monthly_hours || 0));
    }

    // ───── 1. Bleed report ─────
    const bleed = allAssignments.map(a => {
      const e: any = empById.get(a.employee_id);
      const p: any = projById.get(a.project_id);
      const hours = Number(a.monthly_hours || 0);
      if (!e || !p || hours <= 0) return null;
      const margin_per_hour = Number(p.revenuePerHour) - Number(e.rate);
      const monthly_margin = margin_per_hour * hours;

      // Best swap: an OTHER direct-staff employee whose margin on this project
      // is higher AND who has at least `hours` of remaining capacity.
      let bestSwap: any = null;
      for (const cand of directEmps) {
        if (cand.id === e.id) continue;
        const candAlloc = hoursByEmp.get(cand.id) || 0;
        const candFree = Number(cand.capacity || 0) - candAlloc;
        if (candFree < hours) continue;             // must fit
        const cand_mph = Number(p.revenuePerHour) - Number(cand.rate);
        if (cand_mph <= margin_per_hour) continue;  // must improve
        const cand_monthly = cand_mph * hours;
        const net_gain = cand_monthly - monthly_margin;
        if (!bestSwap || net_gain > bestSwap.net_gain) {
          bestSwap = {
            candidate_employee_id: cand.id,
            candidate_employee_name: cand.name,
            candidate_designation: cand.designation,
            candidate_rate: Number(cand.rate),
            candidate_margin_per_hour: cand_mph,
            candidate_monthly_margin: cand_monthly,
            candidate_free_hours: candFree,
            net_gain,
          };
        }
      }

      return {
        assignment_id: a.id,
        employee_id: e.id, employee_name: e.name, employee_designation: e.designation,
        employee_rate: Number(e.rate),
        project_id: p.id, project_name: p.name, project_client_name: p.client_name,
        project_revenue_per_hour: Number(p.revenuePerHour),
        project_revenue: Number(p.revenue),
        hours, margin_per_hour, monthly_margin,
        best_swap: bestSwap,
      };
    }).filter(Boolean) as any[];

    // Sort: worst current margin first
    bleed.sort((a, b) => a.monthly_margin - b.monthly_margin);

    const actionableSwaps = bleed.filter(b => b.best_swap && b.best_swap.net_gain >= threshold);
    const total_potential_gain = actionableSwaps.reduce((s, b) => s + b.best_swap.net_gain, 0);

    // ───── 2. Margin matrix ─────
    const matrixEmployees = [...directEmps].sort((a: any, b: any) => Number(b.rate) - Number(a.rate));
    const matrixProjects = [...projects].sort((a: any, b: any) => Number(b.revenuePerHour) - Number(a.revenuePerHour));
    const assignmentByPair = new Map<string, any>();
    for (const a of allAssignments) assignmentByPair.set(`${a.employee_id}__${a.project_id}`, a);

    const cells: any[] = [];
    for (const e of matrixEmployees as any[]) {
      for (const p of matrixProjects as any[]) {
        const a = assignmentByPair.get(`${e.id}__${p.id}`);
        const hours = a ? Number(a.monthly_hours || 0) : 0;
        const margin_per_hour = Number(p.revenuePerHour) - Number(e.rate);
        cells.push({
          employee_id: e.id, project_id: p.id,
          hours,
          margin_per_hour,
          monthly_margin: margin_per_hour * hours,
          assigned: hours > 0,
        });
      }
    }

    // ───── 3. Leverage score ─────
    const leverage = directEmps.map((e: any) => {
      const totalHours = hoursByEmp.get(e.id) || 0;
      // Revenue produced = sum over their assignments of (hours × project rev/h)
      let revenue_produced = 0;
      let projectsOn = 0;
      for (const a of allAssignments) {
        if (a.employee_id !== e.id) continue;
        const p: any = projById.get(a.project_id);
        if (!p) continue;
        const h = Number(a.monthly_hours || 0);
        if (h > 0) {
          revenue_produced += h * Number(p.revenuePerHour);
          projectsOn++;
        }
      }
      const salary = Number(e.salary);
      const lev = salary > 0 ? revenue_produced / salary : 0;
      let verdict: 'great' | 'ok' | 'underused' | 'bench';
      if (lev >= 4) verdict = 'great';
      else if (lev >= 2.5) verdict = 'ok';
      else if (lev >= 1.5) verdict = 'underused';
      else verdict = 'bench';
      return {
        employee_id: e.id, name: e.name, designation: e.designation, department: e.department,
        salary, rate: Number(e.rate),
        hours_allocated: totalHours, capacity: Number(e.capacity),
        utilization: Number(e.capacity || 0) > 0 ? totalHours / Number(e.capacity) : 0,
        projects_on: projectsOn,
        revenue_produced,
        margin_produced: revenue_produced - salary,
        leverage: lev,
        verdict,
      };
    }).sort((a, b) => b.leverage - a.leverage);

    res.json({
      month, year,
      currency: model.settings.currency,
      threshold,
      bleed: {
        rows: bleed,
        actionable_count: actionableSwaps.length,
        total_potential_gain,
      },
      matrix: {
        employees: matrixEmployees.map((e: any) => ({ id: e.id, name: e.name, rate: Number(e.rate), salary: Number(e.salary), designation: e.designation })),
        projects: matrixProjects.map((p: any) => ({
          id: p.id, name: p.name, client_name: p.client_name,
          revenue_per_hour: Number(p.revenuePerHour), revenue: Number(p.revenue),
          direct_hours: Number(p.directHours),
        })),
        cells,
      },
      leverage,
    });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Manager P&L (admin-only) ────────────────────────────────────────────
// Reporting managers don't have direct billable hours of their own, so we
// measure them by their team's output. For each employee who has at least
// one direct report this month, we sum the team's revenue_produced and
// salary, add the manager's own salary (and their own revenue_produced if
// they're billing — flagged as is_billing_manager), and compute:
//   net_contribution = team_revenue + manager_revenue
//                    − team_salary − manager_salary
//   leverage         = (team_revenue + manager_revenue)
//                    ÷ (team_salary + manager_salary)
//
// scope=direct → only direct reports
// scope=subtree → full recursive sub-tree (descendants)
app.get('/api/finance/manager-pnl', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year = Number(req.query.year) || new Date().getFullYear();
    const scope = (req.query.scope === 'subtree') ? 'subtree' : 'direct';

    const model = await finComputeMonth(month, year);
    const empById = new Map<string, any>(model.employeeRows.map((e: any) => [e.id, e]));
    const projById = new Map<string, any>(model.projectRows.map((p: any) => [p.id, p]));

    // Raw assignments to compute revenue_produced per employee
    const assignments = (await sql`
      SELECT project_id, employee_id, monthly_hours
      FROM project_assignments
      WHERE month=${month} AND year=${year}`) as any[];

    // revenue_produced per employee = sum over their assignments of (hours × project rev/h)
    const revenueByEmp = new Map<string, number>();
    const hoursByEmp = new Map<string, number>();
    for (const a of assignments) {
      const p: any = projById.get(a.project_id);
      const h = Number(a.monthly_hours || 0);
      if (h <= 0) continue;
      hoursByEmp.set(a.employee_id, (hoursByEmp.get(a.employee_id) || 0) + h);
      if (!p) continue;
      revenueByEmp.set(a.employee_id, (revenueByEmp.get(a.employee_id) || 0) + h * Number(p.revenuePerHour));
    }

    // Who has direct reports? Find all (manager_id, report_id) pairs.
    const reportRows = (await sql`
      SELECT id, reporting_manager_id, name, designation, department, status
      FROM employees
      WHERE reporting_manager_id IS NOT NULL AND status='active'`) as any[];

    const directReportsByManager = new Map<string, string[]>();
    for (const r of reportRows) {
      const mgr = r.reporting_manager_id;
      if (!mgr) continue;
      const arr = directReportsByManager.get(mgr) || [];
      arr.push(r.id);
      directReportsByManager.set(mgr, arr);
    }

    // For sub-tree scope, walk descendants.
    const descendantsOf = (managerId: string): string[] => {
      const out: string[] = [];
      const stack = [managerId];
      const seen = new Set<string>();
      while (stack.length) {
        const next = stack.pop()!;
        for (const child of directReportsByManager.get(next) || []) {
          if (seen.has(child)) continue;
          seen.add(child);
          out.push(child);
          stack.push(child);
        }
      }
      return out;
    };

    const managers: any[] = [];
    for (const [managerId, directIds] of directReportsByManager) {
      const manager: any = empById.get(managerId);
      if (!manager) continue; // manager not in finance_employee_meta (not classified) — skip
      const reportIds = scope === 'subtree' ? descendantsOf(managerId) : directIds;
      if (reportIds.length === 0) continue;

      // Aggregate team
      let teamSalary = 0;
      let teamRevenue = 0;
      let teamAllocatedHours = 0;
      let teamCapacity = 0;
      const reports: any[] = [];
      for (const rid of reportIds) {
        const rep: any = empById.get(rid);
        if (!rep) continue;
        const repRev = revenueByEmp.get(rid) || 0;
        const repHrs = hoursByEmp.get(rid) || 0;
        teamSalary += Number(rep.salary || 0);
        teamRevenue += repRev;
        teamAllocatedHours += repHrs;
        teamCapacity += Number(rep.capacity || 0);
        reports.push({
          id: rep.id, name: rep.name, designation: rep.designation, department: rep.department,
          cost_type: rep.cost_type,
          salary: Number(rep.salary), rate: Number(rep.rate),
          hours_allocated: repHrs, capacity: Number(rep.capacity),
          utilization: Number(rep.capacity || 0) > 0 ? repHrs / Number(rep.capacity) : 0,
          revenue_produced: repRev,
          leverage: Number(rep.salary) > 0 ? repRev / Number(rep.salary) : 0,
        });
      }

      // Manager's own billing
      const mgrRevenue = revenueByEmp.get(managerId) || 0;
      const mgrHours = hoursByEmp.get(managerId) || 0;
      const isBilling = mgrRevenue > 0 || mgrHours > 0;

      const mgrSalary = Number(manager.salary || 0);
      const totalRevenue = teamRevenue + mgrRevenue;
      const allInCost = teamSalary + mgrSalary;
      const netContribution = totalRevenue - allInCost;
      const leverage = allInCost > 0 ? totalRevenue / allInCost : 0;

      let verdict: 'great' | 'ok' | 'underused' | 'bench';
      if (leverage >= 4) verdict = 'great';
      else if (leverage >= 2.5) verdict = 'ok';
      else if (leverage >= 1.5) verdict = 'underused';
      else verdict = 'bench';

      managers.push({
        manager_id: manager.id,
        manager_name: manager.name,
        manager_designation: manager.designation,
        manager_department: manager.department,
        manager_cost_type: manager.cost_type,
        manager_salary: mgrSalary,
        manager_revenue_produced: mgrRevenue,
        manager_hours: mgrHours,
        manager_capacity: Number(manager.capacity || 0),
        is_billing_manager: isBilling,
        reports_count: reports.length,
        team_salary: teamSalary,
        team_revenue_produced: teamRevenue,
        team_allocated_hours: teamAllocatedHours,
        team_capacity: teamCapacity,
        team_utilization: teamCapacity > 0 ? teamAllocatedHours / teamCapacity : 0,
        all_in_cost: allInCost,
        total_revenue: totalRevenue,
        net_contribution: netContribution,
        leverage,
        verdict,
        reports: reports.sort((a, b) => b.leverage - a.leverage),
      });
    }

    // Sort by net contribution desc
    managers.sort((a, b) => b.net_contribution - a.net_contribution);

    // Org-wide aggregate (across all listed managers, no double counting since
    // each report appears under exactly one direct manager in 'direct' scope;
    // in 'subtree' the same person can appear in multiple manager sub-trees,
    // so org totals are computed from finComputeMonth itself rather than summed).
    const orgRevenue = managers.reduce((s, m) => s + m.team_revenue_produced + m.manager_revenue_produced, 0);
    const orgManagerSalary = managers.reduce((s, m) => s + m.manager_salary, 0);
    const orgTeamSalary = managers.reduce((s, m) => s + m.team_salary, 0);
    const orgAllIn = orgManagerSalary + orgTeamSalary;

    res.json({
      month, year, scope,
      currency: model.settings.currency,
      total: {
        manager_count: managers.length,
        report_count: managers.reduce((s, m) => s + m.reports_count, 0),
        manager_salary_total: orgManagerSalary,
        team_salary_total: orgTeamSalary,
        team_revenue_total: orgRevenue,
        org_leverage: orgAllIn > 0 ? orgRevenue / orgAllIn : 0,
        org_net_contribution: orgRevenue - orgAllIn,
      },
      managers,
    });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// GET /api/finance/trends?month=&year=  → 12 months up to and including the given month
app.get('/api/finance/trends', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const month = Number(req.query.month), year = Number(req.query.year);
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    const out: any[] = [];
    for (let i = 11; i >= 0; i--) {
      const idx = (year * 12 + (month - 1)) - i;
      const y = Math.floor(idx / 12), m = (idx % 12) + 1;
      const model = await finComputeMonth(m, y);
      out.push({ month: m, year: y, ...model.totals });
    }
    res.json(out);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Settings
app.get('/api/finance/settings', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try { res.json(await finGetSettings()); }
  catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});
app.put('/api/finance/settings', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { working_hours_per_month, overhead_method, currency, include_bench_in_overhead } = req.body;
    await sql`UPDATE fin_settings SET
      working_hours_per_month = ${Number(working_hours_per_month) || 176},
      overhead_method = ${overhead_method || 'direct_hours'},
      currency = ${currency || '₹'},
      include_bench_in_overhead = ${!!include_bench_in_overhead}
      WHERE id = 1`;
    res.json(await finGetSettings());
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Employee classification (direct / indirect / unclassified)
app.get('/api/finance/employees', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const rows = await sql`
      SELECT e.id, e.name, e.designation, e.department, COALESCE(e.salary,0) AS salary,
             m.cost_type, m.capacity_hours, m.active
      FROM employees e
      LEFT JOIN fin_employee_meta m ON m.employee_id = e.id
      WHERE e.status = 'active'
      ORDER BY e.name`;
    res.json((rows as any[]).map((r) => ({ ...r, salary: Number(r.salary) })));
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});
app.put('/api/finance/employees/:id', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = req.params.id;
    const { cost_type, capacity_hours, active } = req.body;
    if (cost_type === 'none' || cost_type == null) {
      await sql`DELETE FROM fin_employee_meta WHERE employee_id = ${id}`; // unclassify
      return res.json({ employee_id: id, cost_type: null });
    }
    const cap = capacity_hours === '' || capacity_hours == null ? null : Number(capacity_hours);
    const act = active === undefined ? true : !!active;
    await sql`
      INSERT INTO fin_employee_meta (employee_id, cost_type, capacity_hours, active)
      VALUES (${id}, ${cost_type}, ${cap}, ${act})
      ON CONFLICT (employee_id) DO UPDATE SET
        cost_type = EXCLUDED.cost_type, capacity_hours = EXCLUDED.capacity_hours, active = EXCLUDED.active`;
    res.json({ employee_id: id, cost_type, capacity_hours: cap, active: act });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Per-project monthly revenue (admin-only)
app.get('/api/finance/revenue', async (req, res) => {
  await runStartupMigrations();
  // Coordinators need to set USD amounts on Upwork projects in Billing Setup,
  // so this endpoint is open to admin/HR/coord. The Finance dashboard itself
  // (where org-wide totals live) stays admin-only.
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const month = Number(req.query.month), year = Number(req.query.year);
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    const rows = await sql`
      SELECT p.id, p.name, p.client_name, p.billing_source,
             r.billing_type, r.fixed_amount, r.hourly_rate, r.billable_hours,
             r.currency, r.fx_rate, r.revenue_inr,
             r.status, r.amount_received, r.received_inr, r.received_fx_rate,
             r.cleared_at, r.cleared_by, r.cleared_by_name, r.clearance_note
      FROM projects p
      LEFT JOIN fin_project_revenue r ON r.project_id = p.id AND r.month = ${month} AND r.year = ${year}
      WHERE p.status = 'active'
      ORDER BY p.name`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});
app.put('/api/finance/revenue', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const { project_id, month, year, billing_type, fixed_amount, hourly_rate, billable_hours, currency, fx_rate } = req.body;
    if (!project_id || !month || !year) return res.status(400).json({ error: 'project_id, month, year are required' });
    const ccy = (currency || 'INR').toUpperCase();
    // FX rate: if client passes one (it shows the live preview to the user),
    // use it; otherwise look up. INR is always 1.
    let rate: number;
    if (fx_rate != null) rate = Number(fx_rate);
    else if (ccy === 'INR') rate = 1;
    else {
      const today = new Date().toISOString().slice(0, 10);
      rate = (await getFxRate(today, ccy, 'INR')).rate;
    }
    const fa = Number(fixed_amount) || 0;
    const hr = Number(hourly_rate) || 0;
    const bh = Number(billable_hours) || 0;
    const rawRevenue = (billing_type || 'fixed') === 'hourly' ? hr * bh : fa;
    const revenueInr = rawRevenue * rate;
    // Refuse to overwrite a cleared row from this endpoint — admin must reopen
    // first. Prevents accidental "edit billing setup" wiping a received-amount
    // record.
    const existing = (await sql`SELECT status FROM fin_project_revenue WHERE project_id=${project_id} AND month=${Number(month)} AND year=${Number(year)}`)[0] as any;
    if (existing?.status === 'cleared') {
      return res.status(409).json({ error: 'This billing entry is already cleared. Reopen it first to edit.' });
    }
    await sql`
      INSERT INTO fin_project_revenue (project_id, month, year, billing_type, fixed_amount, hourly_rate, billable_hours, currency, fx_rate, revenue_inr, status)
      VALUES (${project_id}, ${Number(month)}, ${Number(year)}, ${billing_type || 'fixed'},
              ${fa}, ${hr}, ${bh}, ${ccy}, ${rate}, ${revenueInr}, 'pending')
      ON CONFLICT (project_id, month, year) DO UPDATE SET
        billing_type = EXCLUDED.billing_type, fixed_amount = EXCLUDED.fixed_amount,
        hourly_rate = EXCLUDED.hourly_rate, billable_hours = EXCLUDED.billable_hours,
        currency = EXCLUDED.currency, fx_rate = EXCLUDED.fx_rate, revenue_inr = EXCLUDED.revenue_inr,
        status = COALESCE(fin_project_revenue.status, 'pending')`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Mark an Upwork billing entry as received. Admin enters the actual amount
// (in the same currency the entry was raised), we look up the FX rate as-of
// today and lock the INR equivalent — so realized revenue uses real money,
// not the optimistic invoiced figure.
app.patch('/api/finance/revenue/:project_id/:month/:year/clear', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { project_id, month, year } = req.params;
    const mY = Number(month), yY = Number(year);
    const row = (await sql`SELECT r.*, p.name AS project_name, p.billing_source FROM fin_project_revenue r LEFT JOIN projects p ON p.id=r.project_id WHERE r.project_id=${project_id} AND r.month=${mY} AND r.year=${yY}`)[0] as any;
    if (!row) return res.status(404).json({ error: 'No billing entry for this period' });
    const invoiced = Number(row.revenue_inr ?? 0);
    const invoicedNative = row.billing_type === 'hourly'
      ? Number(row.hourly_rate) * Number(row.billable_hours)
      : Number(row.fixed_amount);
    const { amount_received, clearance_note, fx_rate: clientRate } = req.body ?? {};
    // Default received to invoicedNative (most common case: paid in full).
    const received = amount_received != null ? Number(amount_received) : invoicedNative;
    if (received < 0) return res.status(400).json({ error: 'amount_received cannot be negative' });
    const ccy = (row.currency || 'INR').toUpperCase();
    let rate: number;
    if (clientRate != null) rate = Number(clientRate);
    else if (ccy === 'INR') rate = 1;
    else {
      const today = new Date().toISOString().slice(0, 10);
      rate = (await getFxRate(today, ccy, 'INR')).rate;
    }
    const receivedInr = received * rate;
    const adminUser = (await sql`SELECT id, name FROM app_users WHERE id=${(req.headers['x-user-id'] as string) || ''}`)[0] as any;
    const updated = (await sql`
      UPDATE fin_project_revenue SET
        status='cleared',
        amount_received=${received},
        received_inr=${receivedInr},
        received_fx_rate=${rate},
        cleared_at=NOW(),
        cleared_by=${adminUser?.id ?? null},
        cleared_by_name=${adminUser?.name ?? null},
        clearance_note=${clearance_note?.trim() || null}
      WHERE project_id=${project_id} AND month=${mY} AND year=${yY}
      RETURNING *`)[0];
    // Notify the coordinator (or whoever last saved) that their billing was cleared.
    const variance = receivedInr - invoiced;
    const varianceMsg = Math.abs(variance) < 1 ? 'paid in full' : variance < 0 ? `short by ₹${Math.round(Math.abs(variance)).toLocaleString('en-IN')}` : `extra ₹${Math.round(variance).toLocaleString('en-IN')}`;
    notifyAdminsAndHR('invoice_cleared', 'Upwork billing cleared',
      `${row.project_name ?? 'Project'} (${ccy} ${received.toLocaleString('en-IN')}) — ${varianceMsg}.`).catch(() => {});
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// One-shot cleanup: delete fin_project_revenue rows whose project is NOT
// flagged as Upwork. Used after we made Billing Setup Upwork-only — the
// historical direct-project rows linger in the table and still drive revenue
// via revenueOf() when no invoice exists. Calling this leaves only the
// Upwork rows behind. Safe to run multiple times (subsequent runs are no-ops).
app.post('/api/finance/revenue/cleanup-direct', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const dryRun = req.body?.dry_run === true;
    const toDelete = (await sql`
      SELECT r.project_id, r.month, r.year, p.name, p.billing_source
      FROM fin_project_revenue r
      JOIN projects p ON p.id = r.project_id
      WHERE COALESCE(p.billing_source, 'direct') <> 'upwork'`) as any[];
    if (dryRun) return res.json({ would_delete: toDelete.length, sample: toDelete.slice(0, 5) });
    await sql`
      DELETE FROM fin_project_revenue
      WHERE project_id IN (
        SELECT id FROM projects WHERE COALESCE(billing_source, 'direct') <> 'upwork'
      )`;
    res.json({ deleted: toDelete.length });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.patch('/api/finance/revenue/:project_id/:month/:year/reopen', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { project_id, month, year } = req.params;
    const updated = (await sql`
      UPDATE fin_project_revenue SET
        status='pending',
        amount_received=NULL, received_inr=NULL, received_fx_rate=NULL,
        cleared_at=NULL, cleared_by=NULL, cleared_by_name=NULL, clearance_note=NULL
      WHERE project_id=${project_id} AND month=${Number(month)} AND year=${Number(year)}
      RETURNING *`)[0];
    if (!updated) return res.status(404).json({ error: 'Billing entry not found' });
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});
// Create a project FROM the finance module — writes a real projects row (so it
// shows up in Project Mgmt too) and sets its billing for the given month.
app.post('/api/finance/projects', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { name, client_name, project_type, month, year, billing_type, fixed_amount, hourly_rate, billable_hours, created_by } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Project name is required' });
    const id = newId('proj');
    const rows = await sql`
      INSERT INTO projects (id, name, client_name, project_type, status, created_by)
      VALUES (${id}, ${name.trim()}, ${client_name?.trim() || null}, ${project_type || null}, 'active', ${created_by || null})
      RETURNING *`;
    if (month && year) {
      await sql`
        INSERT INTO fin_project_revenue (project_id, month, year, billing_type, fixed_amount, hourly_rate, billable_hours)
        VALUES (${id}, ${Number(month)}, ${Number(year)}, ${billing_type || 'fixed'},
                ${Number(fixed_amount) || 0}, ${Number(hourly_rate) || 0}, ${Number(billable_hours) || 0})
        ON CONFLICT (project_id, month, year) DO UPDATE SET
          billing_type = EXCLUDED.billing_type, fixed_amount = EXCLUDED.fixed_amount,
          hourly_rate = EXCLUDED.hourly_rate, billable_hours = EXCLUDED.billable_hours`;
    }
    res.status(201).json((rows as any[])[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Copy revenue + overhead from a previous month into the target month (if empty)
app.post('/api/finance/copy-month', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { from_month, from_year, to_month, to_year } = req.body;
    if (!from_month || !from_year || !to_month || !to_year) return res.status(400).json({ error: 'from/to month & year required' });
    await sql`
      INSERT INTO fin_project_revenue (project_id, month, year, billing_type, fixed_amount, hourly_rate, billable_hours)
      SELECT project_id, ${Number(to_month)}, ${Number(to_year)}, billing_type, fixed_amount, hourly_rate, billable_hours
      FROM fin_project_revenue WHERE month=${Number(from_month)} AND year=${Number(from_year)}
      ON CONFLICT (project_id, month, year) DO NOTHING`;
    await sql`
      INSERT INTO fin_other_costs (month, year, name, amount, category)
      SELECT ${Number(to_month)}, ${Number(to_year)}, name, amount, category
      FROM fin_other_costs WHERE month=${Number(from_month)} AND year=${Number(from_year)}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Overhead costs (admin-only)
app.get('/api/finance/overhead', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const month = Number(req.query.month), year = Number(req.query.year);
    if (!month || !year) return res.status(400).json({ error: 'month and year are required' });
    res.json(await sql`SELECT * FROM fin_other_costs WHERE month=${month} AND year=${year} ORDER BY amount DESC`);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});
app.post('/api/finance/overhead', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { month, year, name, amount, category } = req.body;
    if (!month || !year || !name?.trim()) return res.status(400).json({ error: 'month, year, name are required' });
    const rows = await sql`
      INSERT INTO fin_other_costs (month, year, name, amount, category)
      VALUES (${Number(month)}, ${Number(year)}, ${name.trim()}, ${Number(amount) || 0}, ${category || 'general'})
      RETURNING *`;
    res.json((rows as any[])[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});
app.put('/api/finance/overhead/:id', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { name, amount, category } = req.body;
    const rows = await sql`
      UPDATE fin_other_costs SET name=${name?.trim() || ''}, amount=${Number(amount) || 0}, category=${category || 'general'}
      WHERE id=${Number(req.params.id)} RETURNING *`;
    res.json((rows as any[])[0] || {});
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});
app.delete('/api/finance/overhead/:id', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    await sql`DELETE FROM fin_other_costs WHERE id=${Number(req.params.id)}`;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Per-project expenses (outsourced services, content, ads, etc.) ──
// Admin / HR / project_coordinator can manage. Subtracted from the project's
// revenue in the profitability engine. Coordinators get write access because
// they're closest to the day-to-day vendor spend on the projects they run.
app.get('/api/finance/project-expenses', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;
    const project_id = (req.query.project_id as string) || null;
    const rows = await sql`
      SELECT e.*, p.name AS project_name, p.client_name AS project_client_name
      FROM fin_project_expenses e
      LEFT JOIN projects p ON p.id = e.project_id
      WHERE (${month}::int IS NULL OR e.month=${month})
        AND (${year}::int IS NULL OR e.year=${year})
        AND (${project_id}::text IS NULL OR e.project_id=${project_id})
      ORDER BY e.created_at DESC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/finance/project-expenses', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const { project_id, month, year, vendor, description, amount, category } = req.body;
    if (!project_id || !month || !year) return res.status(400).json({ error: 'project_id, month, year are required' });
    if (!description?.trim()) return res.status(400).json({ error: 'description is required' });
    if (amount == null || Number(amount) < 0) return res.status(400).json({ error: 'amount must be a non-negative number' });
    const rows = await sql`
      INSERT INTO fin_project_expenses (project_id, month, year, vendor, description, amount, category, created_by, created_by_role)
      VALUES (${project_id}, ${month}, ${year}, ${vendor || null}, ${description.trim()}, ${Number(amount)},
              ${category || 'outsource'}, ${gate.user?.name ?? null}, ${gate.user?.role ?? null})
      RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/finance/project-expenses/:id', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const { vendor, description, amount, category, month, year } = req.body;
    if (amount != null && Number(amount) < 0) return res.status(400).json({ error: 'amount must be a non-negative number' });
    const rows = await sql`
      UPDATE fin_project_expenses SET
        vendor=${vendor ?? null},
        description=${(description ?? '').trim() || null},
        amount=${amount != null ? Number(amount) : null},
        category=${category ?? null},
        month=${month ?? null},
        year=${year ?? null}
      WHERE id=${Number(req.params.id)}
      RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Expense not found' });
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/finance/project-expenses/:id', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    await sql`DELETE FROM fin_project_expenses WHERE id=${Number(req.params.id)}`;
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── FX rates (Frankfurter, cached per business day) ──────────────────────
// Coordinator raises invoices in USD (or other foreign currency) but the
// company's home currency is INR — every dashboard number rolls up in INR.
// We fetch the day's spot rate once and cache it; subsequent reads for the
// same date are instant. Frankfurter (ECB-sourced) is free and key-less.

async function getFxRate(date: string, from: string, to: string): Promise<{ rate: number; source: 'cache' | 'frankfurter' | 'fallback'; effective_date: string }> {
  if (from === to) return { rate: 1, source: 'cache', effective_date: date };
  // 1) Check cache for exact date
  const cached = await sql`
    SELECT rate, rate_date FROM fin_fx_rates
    WHERE from_currency=${from} AND to_currency=${to} AND rate_date=${date}
    LIMIT 1`.catch(() => []);
  if ((cached as any[]).length > 0) {
    const r = (cached as any[])[0];
    return { rate: Number(r.rate), source: 'cache', effective_date: String(r.rate_date).slice(0, 10) };
  }
  // 2) Fetch from Frankfurter — returns the closest business-day rate if the
  //    requested date is a weekend/holiday.
  try {
    const url = `https://api.frankfurter.app/${date}?from=${from}&to=${to}`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data: any = await resp.json();
      const rate = Number(data?.rates?.[to]);
      const effective = String(data?.date || date);
      if (rate > 0) {
        // Cache both: the originally-requested date AND the effective date
        // Frankfurter returned (so future lookups for the same business day
        // are also instant).
        await sql`
          INSERT INTO fin_fx_rates (rate_date, from_currency, to_currency, rate)
          VALUES (${date}, ${from}, ${to}, ${rate})
          ON CONFLICT (rate_date, from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, fetched_at=NOW()`.catch(()=>{});
        if (effective !== date) {
          await sql`
            INSERT INTO fin_fx_rates (rate_date, from_currency, to_currency, rate)
            VALUES (${effective}, ${from}, ${to}, ${rate})
            ON CONFLICT (rate_date, from_currency, to_currency) DO UPDATE SET rate=EXCLUDED.rate, fetched_at=NOW()`.catch(()=>{});
        }
        return { rate, source: 'frankfurter', effective_date: effective };
      }
    }
  } catch { /* fall through to last-known cached rate */ }
  // 3) Fall back to most recent cached rate for the pair, regardless of date
  const recent = await sql`
    SELECT rate, rate_date FROM fin_fx_rates
    WHERE from_currency=${from} AND to_currency=${to}
    ORDER BY rate_date DESC LIMIT 1`.catch(() => []);
  if ((recent as any[]).length > 0) {
    const r = (recent as any[])[0];
    return { rate: Number(r.rate), source: 'fallback', effective_date: String(r.rate_date).slice(0, 10) };
  }
  // Last-resort hard fallback so we never crash. ~current USD→INR.
  return { rate: 83.5, source: 'fallback', effective_date: date };
}

app.get('/api/finance/fx-rate', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const from = ((req.query.from as string) || 'USD').toUpperCase();
    const to = ((req.query.to as string) || 'INR').toUpperCase();
    const r = await getFxRate(date, from, to);
    res.json({ date, from, to, ...r });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// ── Project invoices ─────────────────────────────────────────────────────
// Coordinator raises an invoice (amount_invoiced, status='pending').
// Admin marks it cleared with the actual received amount (which may differ
// due to TDS, FX, partial payment, etc.). Both numbers are kept so the owner
// can compare what was billed vs what landed in the bank.

const fmtMoney = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmtMoneyCcy = (n: number, ccy: string) => {
  const v = Math.round(n).toLocaleString('en-IN');
  if (ccy === 'INR') return `₹${v}`;
  if (ccy === 'USD') return `$${v}`;
  return `${ccy} ${v}`;
};

app.get('/api/finance/invoices', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year = req.query.year ? Number(req.query.year) : null;
    const project_id = (req.query.project_id as string) || null;
    const status = (req.query.status as string) || null;
    const rows = await sql`
      SELECT i.*, p.name AS project_name, p.client_name AS project_client_name
      FROM fin_project_invoices i
      LEFT JOIN projects p ON p.id = i.project_id
      WHERE (${month}::int IS NULL OR i.month=${month})
        AND (${year}::int IS NULL OR i.year=${year})
        AND (${project_id}::text IS NULL OR i.project_id=${project_id})
        AND (${status}::text IS NULL OR i.status=${status})
      ORDER BY i.invoice_date DESC NULLS LAST, i.created_at DESC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.post('/api/finance/invoices', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const { project_id, month, year, invoice_number, invoice_date, amount_invoiced, notes, currency, fx_rate } = req.body;
    if (!project_id || !month || !year) return res.status(400).json({ error: 'project_id, month, year are required' });
    if (amount_invoiced == null || Number(amount_invoiced) <= 0) return res.status(400).json({ error: 'amount_invoiced must be > 0' });
    const proj = (await sql`SELECT id, name FROM projects WHERE id=${project_id}`) as any[];
    if (!proj.length) return res.status(400).json({ error: 'Unknown project' });

    // The invoice_date is the source of truth for the period an invoice
    // belongs to. When provided, we derive month/year from it so dashboard
    // aggregation and the period filter always match what the date says —
    // not whatever month picker happened to be active when the form opened.
    let effectiveMonth = Number(month);
    let effectiveYear = Number(year);
    if (invoice_date) {
      const d = String(invoice_date).slice(0, 10);
      const [yyyy, mm] = d.split('-').map(Number);
      if (yyyy && mm) { effectiveYear = yyyy; effectiveMonth = mm; }
    }

    const ccy = (currency || 'INR').toUpperCase();
    // FX rate: client may pass one (so it matches the live conversion shown
    // in the UI). If absent for a non-INR invoice, auto-fetch using the
    // invoice date so the rate matches "the day work was billed".
    let fxRate: number;
    if (fx_rate != null) {
      fxRate = Number(fx_rate);
    } else if (ccy === 'INR') {
      fxRate = 1;
    } else {
      const d = (invoice_date as string) || new Date().toISOString().slice(0, 10);
      const r = await getFxRate(d, ccy, 'INR');
      fxRate = r.rate;
    }
    const inr = Number(amount_invoiced) * fxRate;

    const rows = await sql`
      INSERT INTO fin_project_invoices
        (project_id, month, year, invoice_number, invoice_date, amount_invoiced,
         currency, fx_rate, amount_invoiced_inr,
         notes, status, created_by, created_by_name, created_by_role)
      VALUES (${project_id}, ${effectiveMonth}, ${effectiveYear},
              ${invoice_number?.trim() || null},
              ${invoice_date || null},
              ${Number(amount_invoiced)},
              ${ccy}, ${fxRate}, ${inr},
              ${notes?.trim() || null},
              'pending',
              ${gate.user?.id ?? null}, ${gate.user?.name ?? null}, ${gate.user?.role ?? null})
      RETURNING *`;
    const inv = rows[0];
    notifyAdminsAndHR(
      'invoice_raised',
      'Invoice Raised',
      `${gate.user?.name ?? 'A coordinator'} raised ${fmtMoneyCcy(Number(amount_invoiced), ccy)}${ccy !== 'INR' ? ` (≈ ${fmtMoney(inr)})` : ''} on ${proj[0].name}${invoice_number ? ` (${invoice_number})` : ''}.`
    ).catch(()=>{});
    res.status(201).json(inv);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.put('/api/finance/invoices/:id', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const id = Number(req.params.id);
    const existing = (await sql`SELECT * FROM fin_project_invoices WHERE id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = existing[0];
    const isAdmin = gate.user?.role === 'admin';
    // Coordinator can only edit own pending invoices; admin can edit any.
    if (!isAdmin) {
      if (inv.status !== 'pending') return res.status(403).json({ error: 'Cleared invoices can only be edited by admin' });
      if (inv.created_by !== gate.user?.id) return res.status(403).json({ error: 'You can only edit invoices you created' });
    }
    const { invoice_number, invoice_date, amount_invoiced, amount_received, notes, month, year, status, currency, fx_rate } = req.body;
    const wasCleared = inv.status === 'cleared';

    // Recompute INR equivalent whenever amount, currency, or fx_rate changes.
    // Admin edits to amount_received stay in INR (the bank reality).
    const newCcy = currency ? String(currency).toUpperCase() : inv.currency || 'INR';
    const newAmt = amount_invoiced != null ? Number(amount_invoiced) : Number(inv.amount_invoiced);
    let newRate: number;
    if (fx_rate != null) newRate = Number(fx_rate);
    else if (newCcy === 'INR') newRate = 1;
    else if (newCcy === inv.currency) newRate = Number(inv.fx_rate ?? 1);
    else {
      const d = (invoice_date as string) || inv.invoice_date || new Date().toISOString().slice(0, 10);
      newRate = (await getFxRate(d, newCcy, 'INR')).rate;
    }
    const newInr = newAmt * newRate;

    // Effective date drives the period — if invoice_date is being changed
    // (or already set), month/year are derived from it. Manual month/year
    // overrides only apply when there's no invoice_date at all.
    const effectiveInvoiceDate = (invoice_date as string) ?? inv.invoice_date;
    let newMonth: number;
    let newYear: number;
    if (effectiveInvoiceDate) {
      const d = String(effectiveInvoiceDate).slice(0, 10);
      const [yyyy, mm] = d.split('-').map(Number);
      newMonth = mm || Number(inv.month);
      newYear = yyyy || Number(inv.year);
    } else {
      newMonth = month != null ? Number(month) : Number(inv.month);
      newYear = year != null ? Number(year) : Number(inv.year);
    }

    const rows = await sql`
      UPDATE fin_project_invoices SET
        invoice_number=COALESCE(${invoice_number?.trim() || null}, invoice_number),
        invoice_date=COALESCE(${invoice_date || null}, invoice_date),
        amount_invoiced=${newAmt},
        currency=${newCcy},
        fx_rate=${newRate},
        amount_invoiced_inr=${newInr},
        amount_received=${isAdmin && amount_received !== undefined ? (amount_received == null ? null : Number(amount_received)) : inv.amount_received},
        notes=COALESCE(${notes !== undefined ? (notes?.trim() || null) : null}, notes),
        month=${newMonth},
        year=${newYear},
        status=COALESCE(${isAdmin && status ? status : null}, status),
        updated_at=NOW()
      WHERE id=${id}
      RETURNING *`;
    if (wasCleared && inv.created_by) {
      notifyUser(inv.created_by, 'invoice_adjusted', 'Invoice Adjusted',
        `Admin updated cleared invoice${inv.invoice_number ? ` ${inv.invoice_number}` : ''}.`).catch(()=>{});
    }
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.patch('/api/finance/invoices/:id/clear', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const existing = (await sql`SELECT i.*, p.name AS project_name FROM fin_project_invoices i LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = existing[0];
    const { amount_received, cleared_date, notes } = req.body;
    // amount_received defaults to amount_invoiced when omitted — the common
    // "paid in full" case.
    const received = amount_received != null ? Number(amount_received) : Number(inv.amount_invoiced);
    if (received < 0) return res.status(400).json({ error: 'amount_received cannot be negative' });
    const adminUser = (await sql`SELECT id, name FROM app_users WHERE id=${(req.headers['x-user-id'] as string) || ''}`) as any[];
    const adminName = adminUser[0]?.name ?? null;
    const adminId = adminUser[0]?.id ?? null;
    const rows = await sql`
      UPDATE fin_project_invoices SET
        amount_received=${received},
        status='cleared',
        cleared_date=${cleared_date || new Date().toISOString().slice(0, 10)},
        cleared_by=${adminId},
        cleared_by_name=${adminName},
        notes=COALESCE(${notes?.trim() || null}, notes),
        updated_at=NOW()
      WHERE id=${id}
      RETURNING *`;
    if (inv.created_by) {
      const variance = received - Number(inv.amount_invoiced);
      const varianceMsg = variance === 0 ? 'paid in full' : variance < 0 ? `short by ${fmtMoney(Math.abs(variance))}` : `extra ${fmtMoney(variance)}`;
      notifyUser(inv.created_by, 'invoice_cleared', 'Invoice Cleared ✅',
        `${inv.project_name} · ${fmtMoney(received)} received (${varianceMsg}).`).catch(()=>{});
    }
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.patch('/api/finance/invoices/:id/reopen', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const existing = (await sql`SELECT * FROM fin_project_invoices WHERE id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const rows = await sql`
      UPDATE fin_project_invoices SET
        status='pending', amount_received=NULL, cleared_date=NULL,
        cleared_by=NULL, cleared_by_name=NULL, updated_at=NOW()
      WHERE id=${id}
      RETURNING *`;
    if (existing[0].created_by) {
      notifyUser(existing[0].created_by, 'invoice_reopened', 'Invoice Reopened',
        `Admin reopened invoice${existing[0].invoice_number ? ` ${existing[0].invoice_number}` : ''} — marked pending again.`).catch(()=>{});
    }
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.delete('/api/finance/invoices/:id', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const id = Number(req.params.id);
    const existing = (await sql`SELECT * FROM fin_project_invoices WHERE id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = existing[0];
    const isAdmin = gate.user?.role === 'admin';
    if (!isAdmin) {
      if (inv.status !== 'pending') return res.status(403).json({ error: 'Only admin can delete a cleared invoice' });
      if (inv.created_by !== gate.user?.id) return res.status(403).json({ error: 'You can only delete invoices you created' });
    }
    await sql`DELETE FROM fin_project_invoices WHERE id=${id}`;
    res.json({ success: true });
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

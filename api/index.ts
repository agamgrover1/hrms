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
async function notifyUser(userId: string, type: string, title: string, body?: string, link?: string) {
  try {
    await sql`INSERT INTO notifications (user_id, type, title, body, link)
              VALUES (${userId}, ${type}, ${title}, ${body ?? null}, ${link ?? null})`;
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

async function notifyEmployeeUser(employeeDbId: string, type: string, title: string, body?: string, link?: string) {
  try {
    const users = await sql`SELECT u.id FROM app_users u JOIN employees e ON e.employee_id = u.employee_id_ref WHERE e.id = ${employeeDbId}`;
    await Promise.all((users as any[]).map((u: any) => notifyUser(u.id, type, title, body, link)));
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

// Fast path for the pulse endpoints: instead of running ~60 sequential
// CREATE/ALTER statements on every cold Lambda (~6-12s, blew past Vercel's
// 10s timeout), do a single existence check on the snapshot table. If it's
// there, all pulse migrations have run before — flip the cached flag and
// skip. Only on a truly fresh DB do we fall back to the full migration.
async function ensurePulseReady() {
  if (_migrated) return;
  try {
    await sql`SELECT 1 FROM performance_score_snapshots LIMIT 0`;
    _migrated = true;
    return;
  } catch {
    await runStartupMigrations();
  }
}

// Auto-heal app_users.employee_id_ref. Three idempotent steps:
//   1. NULL out dangling references — employee_id_ref pointing to a row that
//      no longer exists in employees. Common when an employee is
//      deleted/recreated; the user account keeps the stale pointer and /me
//      can never find the snapshot.
//   2. Fill remaining NULLs by email match (more reliable).
//   3. Fill anything still NULL by name match.
// Result: any user account that *could* be linked, IS linked, on every
// recompute. Admin doesn't have to babysit individual rows.
async function healUserEmployeeLinks(): Promise<{ dangling: number; linkedByEmail: number; linkedByName: number }> {
  let dangling = 0, linkedByEmail = 0, linkedByName = 0;
  try {
    // Dangling = points to nothing — neither matches employees.employee_id
    // (the human-readable code we store) nor employees.id (legacy data
    // from before this comment).
    const danglingRows = await sql`
      UPDATE app_users SET employee_id_ref = NULL
      WHERE employee_id_ref IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM employees
          WHERE employee_id = app_users.employee_id_ref
             OR id = app_users.employee_id_ref
        )
      RETURNING id` as any[];
    dangling = danglingRows.length;
    // Link to the HUMAN-READABLE code, not the internal id — matches what
    // the rest of the app expects.
    const emailRows = await sql`
      UPDATE app_users u SET employee_id_ref = e.employee_id
      FROM employees e
      WHERE u.employee_id_ref IS NULL
        AND LOWER(u.email) = LOWER(e.email)
        AND e.email IS NOT NULL
        AND e.employee_id IS NOT NULL
      RETURNING u.id` as any[];
    linkedByEmail = emailRows.length;
    const nameRows = await sql`
      UPDATE app_users u SET employee_id_ref = e.employee_id
      FROM employees e
      WHERE u.employee_id_ref IS NULL
        AND LOWER(u.name) = LOWER(e.name)
        AND e.employee_id IS NOT NULL
      RETURNING u.id` as any[];
    linkedByName = nameRows.length;
  } catch { /* non-fatal — don't block compute on this */ }
  return { dangling, linkedByEmail, linkedByName };
}
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
  // _migrated gets set at the END (after every statement succeeds), so a
  // mid-migration failure / timeout doesn't lock subsequent calls into
  // skipping the remaining statements.

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
  // Per-notification deep-link override. Used when type+role can't uniquely
  // identify a destination — e.g. an "hours_comment" ping needs to jump to
  // the SPECIFIC log so the employee can reply. When null the TopBar falls
  // back to the role-based getNotifRoute() heuristic.
  await sql`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT`.catch(()=>{});
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
  // Laptop spec fields — surfaced on the asset form ONLY when category=Laptop,
  // but stored unconditionally so HR can record the same fields for any
  // category that has hardware specs (desktop, tablet). admin_password is
  // server-side stripped from GET responses for non-admin/HR roles.
  try {
    await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS brand TEXT`;
    await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS os TEXT`;
    await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS processor TEXT`;
    await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS ram TEXT`;
    await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS storage TEXT`;
    await sql`ALTER TABLE assets ADD COLUMN IF NOT EXISTS admin_password TEXT`;
  } catch { /* idempotent */ }
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

  // Threaded comments on a weekly hour-log. Reviewer can ask the employee
  // for justification on a specific DSR task; employee + admin/HR can reply.
  // Plain TEXT body keeps it simple — no markdown, no attachments yet.
  await sql`
    CREATE TABLE IF NOT EXISTS hour_log_comments (
      id TEXT PRIMARY KEY,
      hour_log_id TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      author_role TEXT,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_hl_comments_log ON hour_log_comments(hour_log_id, created_at)`.catch(()=>{});

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

  // Audit log for billing setup (Upwork projects in fin_project_revenue).
  // Mirrors fin_invoice_audit so admin can answer the same "who did what
  // when" questions on the Billing setup tab. Keyed by (project_id,
  // month, year) since revenue rows aren't single-id like invoices.
  await sql`
    CREATE TABLE IF NOT EXISTS fin_revenue_audit (
      id SERIAL PRIMARY KEY,
      project_id TEXT NOT NULL,
      project_name TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      action TEXT NOT NULL,
      currency TEXT,
      billing_type_before TEXT, billing_type_after TEXT,
      amount_invoiced_before NUMERIC, amount_invoiced_after NUMERIC,
      amount_received_before NUMERIC, amount_received_after NUMERIC,
      status_before TEXT, status_after TEXT,
      notes_before TEXT, notes_after TEXT,
      actor_id TEXT, actor_name TEXT, actor_role TEXT,
      changed_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_rev_audit_when ON fin_revenue_audit(changed_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_rev_audit_project ON fin_revenue_audit(project_id, year, month, changed_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_rev_audit_actor ON fin_revenue_audit(actor_id, changed_at DESC)`.catch(()=>{});
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

  // Audit log for finance invoices — every create / edit / clear / reopen /
  // delete writes a row here so admin can answer "who added this and when"
  // (and trace anything that changed afterwards) without leaving Finance.
  await sql`
    CREATE TABLE IF NOT EXISTS fin_invoice_audit (
      id SERIAL PRIMARY KEY,
      invoice_id INTEGER,
      action TEXT NOT NULL,
      invoice_number TEXT,
      invoice_date DATE,
      project_id TEXT,
      project_name TEXT,
      month INTEGER,
      year INTEGER,
      currency TEXT,
      amount_invoiced_before NUMERIC, amount_invoiced_after NUMERIC,
      amount_received_before NUMERIC, amount_received_after NUMERIC,
      status_before TEXT, status_after TEXT,
      notes_before TEXT, notes_after TEXT,
      actor_id TEXT, actor_name TEXT, actor_role TEXT,
      changed_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_inv_audit_when ON fin_invoice_audit(changed_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_inv_audit_invoice ON fin_invoice_audit(invoice_id, changed_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_fin_inv_audit_actor ON fin_invoice_audit(actor_id, changed_at DESC)`.catch(()=>{});

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

  // ── Internal activities (non-project work) ────────────────────────────
  // Employees, HR, coordinators, and admin all log hours daily. People
  // without active projects (HR, recruiters, bench, admins doing ops work)
  // use this. The list is admin-curated; logs are self-reported and don't
  // need approval. Hours feed compliance + pulse "hours hygiene" but NOT
  // billable utilization (utilization stays a billable measure on purpose).
  await sql`
    CREATE TABLE IF NOT EXISTS internal_activities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      active BOOLEAN DEFAULT TRUE,
      sort_order INTEGER DEFAULT 100,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by TEXT
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS internal_hour_logs (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      log_date DATE NOT NULL,
      hours NUMERIC NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, activity_id, log_date)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_internal_logs_emp_date ON internal_hour_logs(employee_id, log_date DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_internal_logs_date ON internal_hour_logs(log_date DESC)`.catch(()=>{});
  // Approval workflow on internal hour logs. NEW rows land in 'pending'
  // and the reporting manager gets notified; existing pre-approval-era
  // rows backfill to 'approved' so we don't retro-invalidate them.
  // Only 'approved' rows count toward Capacity tables, Pulse hours
  // hygiene, and per-employee totals from this point on.
  //
  // Add the column WITHOUT a default first, backfill NULL rows to
  // 'approved' (those are the pre-feature rows), then set the default
  // and NOT NULL. Fully idempotent — on re-run the ADD is a no-op, the
  // UPDATE finds zero NULLs, and the constraint changes are no-ops.
  await sql`ALTER TABLE internal_hour_logs ADD COLUMN IF NOT EXISTS status TEXT`.catch(()=>{});
  await sql`UPDATE internal_hour_logs SET status='approved' WHERE status IS NULL`.catch(()=>{});
  await sql`ALTER TABLE internal_hour_logs ALTER COLUMN status SET DEFAULT 'pending'`.catch(()=>{});
  await sql`ALTER TABLE internal_hour_logs ALTER COLUMN status SET NOT NULL`.catch(()=>{});
  await sql`ALTER TABLE internal_hour_logs ADD COLUMN IF NOT EXISTS reviewed_by_id TEXT`.catch(()=>{});
  await sql`ALTER TABLE internal_hour_logs ADD COLUMN IF NOT EXISTS reviewed_by_name TEXT`.catch(()=>{});
  await sql`ALTER TABLE internal_hour_logs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`.catch(()=>{});
  await sql`ALTER TABLE internal_hour_logs ADD COLUMN IF NOT EXISTS rejection_reason TEXT`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_internal_logs_status ON internal_hour_logs(status, employee_id)`.catch(()=>{});
  // Role scoping for the activity picker. NULL/empty array = visible to
  // everyone (preserves current behaviour for legacy rows). Non-empty
  // array = only roles listed see the activity. Effective role values
  // are 'admin' / 'hr_manager' / 'project_coordinator' / 'manager' /
  // 'employee'. 'manager' is a synthetic role assigned at request time
  // when the current user has direct reports (employees.reporting_manager_id
  // = them) — that lets HR scope, say, "1:1 prep" to managers only
  // without needing a separate flag on the employee record.
  await sql`ALTER TABLE internal_activities ADD COLUMN IF NOT EXISTS roles TEXT[]`.catch(()=>{});
  // Backfill (idempotent): legacy POST stored employee_id as the HUMAN
  // code (e.g. "DL0092") because it grabbed u.employee_id_ref. But every
  // reader — Pulse compute, the EmployeeHoursDetailModal, the new Hours
  // tab on Employee Profile — queries by the internal employees.id. So
  // internal hour logs were silently invisible to managers/HR/admin (and
  // never counted into Pulse hours hygiene). Convert any row whose
  // employee_id still matches employees.employee_id (the human code) to
  // the internal id. Rows already in internal-id form are unaffected
  // (their value doesn't match any employees.employee_id). Safe to
  // re-run; once converted there's nothing left to update.
  await sql`
    UPDATE internal_hour_logs l
    SET employee_id = e.id
    FROM employees e
    WHERE l.employee_id = e.employee_id
      AND l.employee_id <> e.id`.catch(()=>{});
  // Seed the default activity list once — admin can prune/extend on the
  // Config page. Idempotent: only inserts if the table is empty.
  try {
    const cnt = (await sql`SELECT COUNT(*)::int AS c FROM internal_activities`)[0] as any;
    if (Number(cnt?.c ?? 0) === 0) {
      const seed = [
        { name: 'Admin / Operations',   description: 'General admin & ops work',                      order: 10 },
        { name: 'Recruitment / Hiring', description: 'Interviews, sourcing, offer rounds',            order: 20 },
        { name: 'Training / Learning',  description: 'Onboarding, courses, self-study',               order: 30 },
        { name: 'People Management',    description: '1:1s, performance reviews, team coordination',  order: 40 },
        { name: 'HR / Compliance',      description: 'Policy, payroll, statutory work',               order: 50 },
        { name: 'Internal Initiative',  description: 'Org-wide projects, R&D, tooling',               order: 60 },
        { name: 'Bench / Unallocated',  description: 'Awaiting project allocation',                   order: 70 },
      ];
      for (const a of seed) {
        await sql`INSERT INTO internal_activities (id, name, description, sort_order)
          VALUES (${`act_${a.order}_${a.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`},
                  ${a.name}, ${a.description}, ${a.order})
          ON CONFLICT (name) DO NOTHING`;
      }
    }
  } catch { /* non-fatal */ }

  // ── To-Do tasks ───────────────────────────────────────────────────────
  // Each employee has their own list. Tasks can be self-created OR added by
  // their reporting manager / HR / admin. The creator can always see what
  // they've assigned alongside their own tasks, so they can follow up.
  await sql`
    CREATE TABLE IF NOT EXISTS todo_tasks (
      id TEXT PRIMARY KEY,
      assignee_id TEXT NOT NULL,
      assignee_name TEXT,
      created_by_id TEXT,
      created_by_name TEXT,
      created_by_role TEXT,
      title TEXT NOT NULL,
      description TEXT,
      due_date DATE,
      priority TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TIMESTAMPTZ,
      completion_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_todo_assignee_status ON todo_tasks(assignee_id, status, due_date)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_todo_created_by ON todo_tasks(created_by_id, status)`.catch(()=>{});

  // ─── Granular permissions ──────────────────────────────────────────────
  // Roles (admin/hr_manager/project_coordinator/employee) stay as presets;
  // permission_modules is the catalog of feature areas, role_default_perms
  // is the matrix that each role gets out of the box, and
  // user_permission_overrides lets an admin tweak a specific user's grid
  // without touching the role default. The effective permission for a user
  // on a module is: override (if exists) ELSE role default ELSE all false.
  await sql`
    CREATE TABLE IF NOT EXISTS permission_modules (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      group_label TEXT,
      description TEXT,
      has_approve BOOLEAN NOT NULL DEFAULT FALSE,
      display_order INTEGER NOT NULL DEFAULT 0
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS role_default_permissions (
      role TEXT NOT NULL,
      module_id TEXT NOT NULL,
      can_read BOOLEAN NOT NULL DEFAULT FALSE,
      can_create BOOLEAN NOT NULL DEFAULT FALSE,
      can_modify BOOLEAN NOT NULL DEFAULT FALSE,
      can_delete BOOLEAN NOT NULL DEFAULT FALSE,
      can_approve BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (role, module_id)
    )`;
  await sql`
    CREATE TABLE IF NOT EXISTS user_permission_overrides (
      user_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      can_read BOOLEAN NOT NULL DEFAULT FALSE,
      can_create BOOLEAN NOT NULL DEFAULT FALSE,
      can_modify BOOLEAN NOT NULL DEFAULT FALSE,
      can_delete BOOLEAN NOT NULL DEFAULT FALSE,
      can_approve BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT,
      PRIMARY KEY (user_id, module_id)
    )`;
  // Seed the module catalog once. Idempotent via ON CONFLICT — re-runs
  // won't duplicate or clobber labels admins might want to rename later.
  const SEED_MODULES = [
    { id: 'dashboard',       label: 'Dashboard',           group: 'Overview',  approve: false },
    { id: 'employees',       label: 'Employee Directory',  group: 'People',    approve: false },
    { id: 'users',           label: 'User Management',     group: 'People',    approve: false },
    { id: 'attendance',      label: 'Attendance',          group: 'HR',        approve: false },
    { id: 'leaves',          label: 'Leaves',              group: 'HR',        approve: true  },
    { id: 'wfh',             label: 'Work From Home',      group: 'HR',        approve: true  },
    { id: 'payroll',         label: 'Payroll',             group: 'HR',        approve: false },
    { id: 'performance',     label: 'Performance & Pulse', group: 'HR',        approve: false },
    { id: 'projects',        label: 'Projects',            group: 'Projects',  approve: false },
    { id: 'hours',           label: 'Project Hours',       group: 'Projects',  approve: false },
    { id: 'hour-approvals',  label: 'Hour Approvals',      group: 'Projects',  approve: true  },
    { id: 'finance',         label: 'Profitability',       group: 'Finance',   approve: false },
    { id: 'invoices',        label: 'Invoices',            group: 'Finance',   approve: true  },
    { id: 'expenses',        label: 'Expense Claims',      group: 'Finance',   approve: true  },
    { id: 'incentives',      label: 'Incentives',          group: 'Finance',   approve: true  },
    { id: 'assets',          label: 'Assets & Repairs',    group: 'IT',        approve: false },
    { id: 'features',        label: 'Feature Announcements', group: 'Admin',   approve: true  },
    { id: 'todos',           label: 'To-Do',               group: 'Personal',  approve: false },
    { id: 'configuration',   label: 'Configuration',       group: 'Admin',     approve: false },
  ];
  for (let i = 0; i < SEED_MODULES.length; i++) {
    const m = SEED_MODULES[i];
    await sql`
      INSERT INTO permission_modules (id, label, group_label, has_approve, display_order)
      VALUES (${m.id}, ${m.label}, ${m.group}, ${m.approve}, ${i})
      ON CONFLICT (id) DO NOTHING`;
  }
  // Seed role defaults. Idempotent. The matrix is generous on purpose so
  // existing users keep working exactly as before — fine-grained restriction
  // happens via per-user overrides. Admin gets everything. Employee gets
  // self-service only (todos R/C/M/D; read on directory/projects).
  const _T = true, _F = false;
  type Row = [string, string, boolean, boolean, boolean, boolean, boolean];
  const SEED_DEFAULTS: Row[] = [
    // admin — everything
    ...SEED_MODULES.map(m => ['admin', m.id, _T, _T, _T, _T, _T] as Row),
    // hr_manager — full on people/HR + read on the rest
    ['hr_manager', 'dashboard',      _T, _F, _F, _F, _F],
    ['hr_manager', 'employees',      _T, _T, _T, _T, _F],
    ['hr_manager', 'users',          _T, _T, _T, _T, _F],
    ['hr_manager', 'attendance',     _T, _T, _T, _T, _F],
    ['hr_manager', 'leaves',         _T, _T, _T, _T, _T],
    ['hr_manager', 'wfh',            _T, _T, _T, _T, _T],
    ['hr_manager', 'payroll',        _T, _T, _T, _T, _F],
    ['hr_manager', 'performance',    _T, _T, _T, _T, _F],
    ['hr_manager', 'projects',       _T, _F, _F, _F, _F],
    ['hr_manager', 'hours',          _T, _F, _F, _F, _F],
    ['hr_manager', 'hour-approvals', _T, _F, _F, _F, _F],
    ['hr_manager', 'finance',        _F, _F, _F, _F, _F],
    ['hr_manager', 'invoices',       _F, _F, _F, _F, _F],
    ['hr_manager', 'expenses',       _T, _T, _T, _T, _T],
    ['hr_manager', 'incentives',     _T, _T, _T, _T, _T],
    ['hr_manager', 'assets',         _T, _T, _T, _F, _F],
    ['hr_manager', 'features',       _T, _T, _T, _F, _F],
    ['hr_manager', 'todos',          _T, _T, _T, _T, _F],
    ['hr_manager', 'configuration',  _T, _F, _T, _F, _F],
    // project_coordinator — owns projects + hours + invoices, reads rest
    ['project_coordinator', 'dashboard',      _F, _F, _F, _F, _F],
    ['project_coordinator', 'employees',      _T, _F, _F, _F, _F],
    ['project_coordinator', 'users',          _F, _F, _F, _F, _F],
    ['project_coordinator', 'attendance',     _T, _F, _F, _F, _F],
    ['project_coordinator', 'leaves',         _T, _F, _F, _F, _F],
    ['project_coordinator', 'wfh',            _T, _F, _F, _F, _F],
    ['project_coordinator', 'payroll',        _F, _F, _F, _F, _F],
    ['project_coordinator', 'performance',    _T, _F, _F, _F, _F],
    ['project_coordinator', 'projects',       _T, _T, _T, _T, _F],
    ['project_coordinator', 'hours',          _T, _T, _T, _T, _F],
    ['project_coordinator', 'hour-approvals', _T, _T, _T, _T, _T],
    ['project_coordinator', 'finance',        _F, _F, _F, _F, _F],
    ['project_coordinator', 'invoices',       _T, _T, _T, _F, _F],
    ['project_coordinator', 'expenses',       _T, _T, _F, _F, _F],
    ['project_coordinator', 'incentives',     _T, _T, _F, _F, _F],
    ['project_coordinator', 'assets',         _T, _F, _F, _F, _F],
    ['project_coordinator', 'features',       _F, _F, _F, _F, _F],
    ['project_coordinator', 'todos',          _T, _T, _T, _T, _F],
    ['project_coordinator', 'configuration',  _F, _F, _F, _F, _F],
    // employee — self-service only
    ['employee', 'dashboard',      _F, _F, _F, _F, _F],
    ['employee', 'employees',      _T, _F, _F, _F, _F],
    ['employee', 'users',          _F, _F, _F, _F, _F],
    ['employee', 'attendance',     _T, _T, _F, _F, _F],
    ['employee', 'leaves',         _T, _T, _T, _T, _F],
    ['employee', 'wfh',            _T, _T, _T, _T, _F],
    ['employee', 'payroll',        _T, _F, _F, _F, _F],
    ['employee', 'performance',    _T, _F, _F, _F, _F],
    ['employee', 'projects',       _T, _F, _F, _F, _F],
    ['employee', 'hours',          _T, _T, _T, _T, _F],
    ['employee', 'hour-approvals', _F, _F, _F, _F, _F],
    ['employee', 'finance',        _F, _F, _F, _F, _F],
    ['employee', 'invoices',       _F, _F, _F, _F, _F],
    ['employee', 'expenses',       _T, _T, _T, _T, _F],
    ['employee', 'incentives',     _T, _T, _F, _F, _F],
    ['employee', 'assets',         _T, _F, _F, _F, _F],
    ['employee', 'features',       _F, _F, _F, _F, _F],
    ['employee', 'todos',          _T, _T, _T, _T, _F],
    ['employee', 'configuration',  _F, _F, _F, _F, _F],
  ];
  for (const [role, m, r, c, u, d, a] of SEED_DEFAULTS) {
    await sql`
      INSERT INTO role_default_permissions (role, module_id, can_read, can_create, can_modify, can_delete, can_approve)
      VALUES (${role}, ${m}, ${r}, ${c}, ${u}, ${d}, ${a})
      ON CONFLICT (role, module_id) DO NOTHING`;
  }

  // ── Feature announcements ───────────────────────────────────────────────
  // Template Hub — HR-curated email/letter templates anyone can copy +
  // paste. Body is plain text with {{placeholders}} the user fills in
  // manually after pasting. format='email' carries an optional subject;
  // format='letter' is just body. category groups them on the list
  // (offer, leave, warning, appraisal, misc, etc.) but is free-text
  // so HR can introduce new buckets without a migration. Soft-delete
  // via active=false keeps historical references usable.
  await sql`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      format TEXT NOT NULL DEFAULT 'email',
      subject TEXT,
      body TEXT NOT NULL,
      description TEXT,
      tags TEXT[],
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_id TEXT,
      created_by_name TEXT,
      updated_by_id TEXT,
      updated_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_templates_category ON templates(category, active)`.catch(()=>{});

  // Lightweight "What's new" mechanism. Anyone with admin/HR draft access
  // can write an announcement (title + body + optional image). Admin
  // publishes it. On publish, every user sees a one-time modal popup
  // until they ack it (one row in feature_acks per user per feature).
  await sql`
    CREATE TABLE IF NOT EXISTS company_announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      pinned BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ,
      posted_by_id TEXT, posted_by_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  // Posted-by role so the UI can render "HR Manager" / "Coordinator" /
  // "Employee" chips on each post. NULL for auto-generated rows.
  await sql`ALTER TABLE company_announcements ADD COLUMN IF NOT EXISTS posted_by_role TEXT`.catch(()=>{});
  // Kind discriminates user posts from system-generated occasion posts
  // (birthdays / anniversaries). The Dashboard widget uses it for the
  // 🎂 / 🎯 affordance vs the regular post layout.
  await sql`ALTER TABLE company_announcements ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'user'`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_company_announcements_active ON company_announcements(pinned DESC, created_at DESC)`.catch(()=>{});

  // Comments on company announcements. Anyone signed in can comment; admin /
  // HR (and the comment author) can delete. Stored as a flat list — no
  // threading — to keep the dashboard widget readable.
  await sql`
    CREATE TABLE IF NOT EXISTS announcement_comments (
      id TEXT PRIMARY KEY,
      announcement_id TEXT NOT NULL REFERENCES company_announcements(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      posted_by_id TEXT,
      posted_by_name TEXT,
      posted_by_role TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_announcement_comments_post ON announcement_comments(announcement_id, created_at)`.catch(()=>{});

  await sql`
    CREATE TABLE IF NOT EXISTS feature_announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      image_url TEXT,
      cta_label TEXT,
      cta_url TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      drafted_by_id TEXT,
      drafted_by_name TEXT,
      approved_by_id TEXT,
      approved_by_name TEXT,
      approved_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feature_status ON feature_announcements(status, published_at DESC)`.catch(()=>{});
  // Audience targeting. NULL or [] = everyone. Otherwise JSONB array of
  // any of: 'admin', 'hr_manager', 'project_coordinator', 'employee',
  // 'manager' (pseudo — anyone with direct reports regardless of role).
  // Matching is OR — a feature tagged ['hr_manager','manager'] reaches
  // HR plus anyone with reports.
  await sql`ALTER TABLE feature_announcements ADD COLUMN IF NOT EXISTS target_roles JSONB`.catch(()=>{});

  // Per-user ack so each user only sees each published feature popup once.
  // Composite PK keeps the row count bounded and idempotent on duplicate
  // POSTs (no need for ON CONFLICT logic on the ack endpoint).
  await sql`
    CREATE TABLE IF NOT EXISTS feature_acks (
      user_id TEXT NOT NULL,
      feature_id TEXT NOT NULL,
      acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, feature_id)
    )`;

  // ── Attendance notes ────────────────────────────────────────────────────
  // Short-day / partial-day context. Anyone with access (the employee, their
  // reporting manager up the chain, HR, admin) can attach a note explaining
  // why a particular day was short. One note per (employee, date) — editing
  // overwrites with the latest author. Audit trail lives in updated_at /
  // author_* columns; we don't keep history since the use-case is "what
  // happened that day" not "every revision".
  await sql`
    CREATE TABLE IF NOT EXISTS attendance_notes (
      employee_id TEXT NOT NULL,
      date DATE NOT NULL,
      note TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT,
      author_role TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (employee_id, date)
    )`;
  // Status workflow: employee-authored notes start as 'pending', manager/
  // HR/admin-authored notes auto-approve. Manager / HR can transition
  // pending → approved or pending → rejected with an optional reason.
  await sql`ALTER TABLE attendance_notes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`.catch(()=>{});
  await sql`ALTER TABLE attendance_notes ADD COLUMN IF NOT EXISTS approved_by_id TEXT`.catch(()=>{});
  await sql`ALTER TABLE attendance_notes ADD COLUMN IF NOT EXISTS approved_by_name TEXT`.catch(()=>{});
  await sql`ALTER TABLE attendance_notes ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`.catch(()=>{});
  await sql`ALTER TABLE attendance_notes ADD COLUMN IF NOT EXISTS rejection_reason TEXT`.catch(()=>{});

  // ── Allocation change requests ──────────────────────────────────────────
  // Managers / project reviewers can propose changes to an employee's
  // weekly/monthly allocation on a project. Coordinators (and admin) approve;
  // approval is what actually writes back to project_assignments. We snapshot
  // the current values at request time so the diff stays meaningful even if
  // someone else moves the assignment in the meantime.
  await sql`
    CREATE TABLE IF NOT EXISTS allocation_change_requests (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      project_name TEXT,
      employee_id TEXT NOT NULL,
      employee_name TEXT,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      current_w1 NUMERIC, current_w2 NUMERIC, current_w3 NUMERIC, current_w4 NUMERIC, current_w5 NUMERIC, current_monthly NUMERIC,
      proposed_w1 NUMERIC, proposed_w2 NUMERIC, proposed_w3 NUMERIC, proposed_w4 NUMERIC, proposed_w5 NUMERIC, proposed_monthly NUMERIC,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by_id TEXT, requested_by_name TEXT, requested_by_role TEXT,
      reviewed_by_id TEXT, reviewed_by_name TEXT, reviewed_at TIMESTAMPTZ, review_note TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_alloc_req_status ON allocation_change_requests(status, created_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_alloc_req_assignment ON allocation_change_requests(assignment_id)`.catch(()=>{});

  // ── Project assignment edit audit ───────────────────────────────────────
  // Records every PUT against project_assignments — i.e. every weekly-hour
  // edit, whether from the Plan-tab inline cell editor or the assignment
  // modal. Stores before/after snapshots so the Activity tab can render
  // deltas without hitting any other tables. Inserts that don't change
  // anything (re-save with identical values) are skipped at the application
  // layer to keep the log signal-only.
  await sql`
    CREATE TABLE IF NOT EXISTS project_assignment_audit (
      id SERIAL PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      project_id TEXT, project_name TEXT,
      employee_id TEXT, employee_name TEXT,
      month INTEGER, year INTEGER,
      w1_before NUMERIC, w2_before NUMERIC, w3_before NUMERIC, w4_before NUMERIC, w5_before NUMERIC, monthly_before NUMERIC,
      w1_after  NUMERIC, w2_after  NUMERIC, w3_after  NUMERIC, w4_after  NUMERIC, w5_after  NUMERIC, monthly_after  NUMERIC,
      notes_before TEXT, notes_after TEXT,
      actor_id TEXT, actor_name TEXT, actor_role TEXT,
      changed_at TIMESTAMPTZ DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_pa_audit_period ON project_assignment_audit(year, month, changed_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_pa_audit_assignment ON project_assignment_audit(assignment_id, changed_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_pa_audit_project ON project_assignment_audit(project_id, changed_at DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_pa_audit_employee ON project_assignment_audit(employee_id, changed_at DESC)`.catch(()=>{});

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
  // Client Handling pillar — sourced from monthly_performance.client_satisfaction.
  // Role-conditional like team_stewardship/project_hygiene (only people who
  // actually handle clients carry it). Adding the column to all three pulse
  // tables here; idempotent.
  await sql`ALTER TABLE performance_score_snapshots ADD COLUMN IF NOT EXISTS client_handling NUMERIC`.catch(()=>{});
  await sql`ALTER TABLE performance_monthly_snapshots ADD COLUMN IF NOT EXISTS client_handling NUMERIC`.catch(()=>{});

  // ── New rating dimensions on the monthly review (Phase 1) ─────────────
  // Communication, Ownership, Planning Accuracy and Learning & Growth are
  // axes the original 7 categories missed. They're scored 0-100 like the
  // others. Default 75 mirrors what the form sends today for un-touched
  // dimensions so historical rows stay in a sane band on first read.
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS communication NUMERIC DEFAULT 75`.catch(()=>{});
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS ownership NUMERIC DEFAULT 75`.catch(()=>{});
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS planning_accuracy NUMERIC DEFAULT 75`.catch(()=>{});
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS learning_growth NUMERIC DEFAULT 75`.catch(()=>{});

  // ── Self-review pass ────────────────────────────────────────────────────
  // The employee fills a self-review first (own scores per category +
  // "went well" / "would do differently"). Reviewer sees it side-by-side
  // while filling theirs. Stored on the SAME row so we keep a single
  // source of truth per (employee, month, year). NULL means "not
  // submitted yet" — reviewer can still file their review without it.
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS self_scores JSONB`.catch(()=>{});
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS self_went_well TEXT`.catch(()=>{});
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS self_would_do_differently TEXT`.catch(()=>{});
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS self_submitted_at TIMESTAMPTZ`.catch(()=>{});
  await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ`.catch(()=>{});

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
      client_handling NUMERIC NOT NULL DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by TEXT
    )`;
  await sql`INSERT INTO performance_score_weights (department) VALUES ('_default') ON CONFLICT (department) DO NOTHING`;
  // For existing weights rows from before client_handling existed.
  await sql`ALTER TABLE performance_score_weights ADD COLUMN IF NOT EXISTS client_handling NUMERIC NOT NULL DEFAULT 1`.catch(()=>{});

  // End-of-month closing book for Pulse. Stores ONE row per employee per
  // month with whatever their latest daily snapshot was in that month. We
  // derive month-over-month delta from this — daily snapshots are an
  // implementation detail; the monthly table is the source of truth for
  // historical reporting.
  await sql`
    CREATE TABLE IF NOT EXISTS performance_monthly_snapshots (
      id SERIAL PRIMARY KEY,
      employee_id TEXT NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      total_score NUMERIC NOT NULL,
      band TEXT NOT NULL,
      discipline NUMERIC, hours_hygiene NUMERIC, output NUMERIC, contribution NUMERIC,
      manager_pulse NUMERIC, team_stewardship NUMERIC, project_hygiene NUMERIC,
      is_baseline BOOLEAN DEFAULT FALSE,
      breakdown JSONB,
      closed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(employee_id, month, year)
    )`;
  await sql`CREATE INDEX IF NOT EXISTS idx_perf_monthly_emp ON performance_monthly_snapshots(employee_id, year DESC, month DESC)`.catch(()=>{});
  await sql`CREATE INDEX IF NOT EXISTS idx_perf_monthly_period ON performance_monthly_snapshots(year DESC, month DESC)`.catch(()=>{});

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
    // Exit date — last working day for separated employees. NULL = still
    // on the payroll. Drives salary proration in finComputeMonth: an
    // employee who left on day 10 counts at salary * (worked working
    // days / total working days in the month), not 0 (which understated
    // cost) or full salary (which overstated). From the month AFTER
    // their exit they're automatically excluded from the salary roll-up
    // without admin having to remember to flip fin_employee_meta.active.
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_date DATE`;
    // Manual override for the exit-month salary in case admin needs to
    // bake in leave encashment, bonuses, gratuity, deductions etc. that
    // the working-day proration can't compute. NULL = let the
    // proration math decide. Stored as the FULL INR amount to credit
    // that month, not a delta.
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_salary_override NUMERIC`;
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
    // Per-employee optional-leave allowance. Default is 2/year (the system
    // constant); admin/HR can grant extra via the leave page so the effective
    // cap becomes 2 + optional_extra.
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS optional_extra INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioner_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioned_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`;
    // Optional approver note — anything the manager / HR wants to add when
    // approving (or rejecting). Separate from rejection_reason so it works
    // for both decisions. manager_approver_note tracks the manager stage;
    // approver_note tracks the final HR decision.
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approver_note TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_approver_note TEXT`;
    // Sub-slot for half-day / short-leave so the manager knows WHEN inside
    // the day. half_day → 'morning' | 'evening'. short_leave → 'q1'..'q4'.
    // Null for full_day / unpaid where it's not meaningful.
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS slot TEXT`;
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

  // One-shot data fix. A previous heal commit overwrote app_users.employee_id_ref
  // with employees.id (the internal hash). The rest of the app (Sidebar profile,
  // ShiftEndReminder, HoursCompliance, ProjectHours, MyPortal) was originally
  // built to store the HUMAN-READABLE code there (employees.employee_id like
  // DL0067). This UPDATE walks each "id-shaped" reference back to its
  // human-readable code so every surface displays consistently again.
  // Idempotent — once corrected, the WHERE clause matches no rows.
  try {
    await sql`
      UPDATE app_users u SET employee_id_ref = e.employee_id
      FROM employees e
      WHERE u.employee_id_ref = e.id
        AND e.employee_id IS NOT NULL`;
  } catch { /* non-fatal */ }

  _migrated = true;
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
    // Surface the human-readable employee code (employees.employee_id) so
    // the UI can show e.g. DL0067 anywhere it currently shows the internal
    // employee_id_ref.
    if (safeUser.employee_id_ref) {
      // employee_id_ref usually holds the human code already; defensively
      // match on either column for legacy rows.
      const e = (await sql`
        SELECT employee_id FROM employees
        WHERE employee_id = ${safeUser.employee_id_ref} OR id = ${safeUser.employee_id_ref}
        LIMIT 1`)[0] as any;
      safeUser.employee_code = e?.employee_id ?? null;
    } else {
      safeUser.employee_code = null;
    }
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
      // Resolve the manager filter to BOTH columns (internal id + human code)
      // so the WHERE matches whichever form employees.reporting_manager_id
      // happens to store. Some legacy rows hold the human code; new ones hold
      // the internal id. Without this widening, a manager whose reports were
      // created with the "other" format saw zero team members.
      const mgrRow = (await sql`SELECT id, employee_id FROM employees WHERE id=${reporting_manager_id} OR employee_id=${reporting_manager_id} LIMIT 1`)[0] as any;
      const cands = mgrRow
        // Filter Boolean drops null AND empty strings — critical, otherwise
        // an empty string in cands matches every employee whose
        // reporting_manager_id is also empty (= "no manager set").
        ? [mgrRow.id, mgrRow.employee_id].filter((v: any) => v && String(v).trim() !== '')
        : [reporting_manager_id].filter((v: any) => v && String(v).trim() !== '');
      // Defensive: if we couldn't resolve the manager to any non-empty id,
      // return zero rows rather than the whole table.
      if (cands.length === 0) { res.json([]); return; }
      if (descendants === 'true' || descendants === '1') {
        // Bug fix: NULLIF guards. Without these, the recursive step could
        // join on empty-string === empty-string, which pulled the entire
        // org into Manpreet's "team" because some legacy rows had blank
        // reporting_manager_id values that matched blank id / employee_id
        // values on intermediate rows. We also guard the matched edge
        // (e.reporting_manager_id) so blanks on the child side never count
        // as a real edge.
        const rows = await sql`
          WITH RECURSIVE team AS (
            SELECT * FROM employees
            WHERE reporting_manager_id = ANY(${cands}::text[])
              AND NULLIF(TRIM(reporting_manager_id), '') IS NOT NULL
            UNION
            SELECT e.* FROM employees e
            JOIN team t ON
              (NULLIF(TRIM(e.reporting_manager_id), '') IS NOT NULL)
              AND (
                (NULLIF(TRIM(t.id), '') IS NOT NULL AND e.reporting_manager_id = t.id)
                OR (NULLIF(TRIM(t.employee_id), '') IS NOT NULL AND e.reporting_manager_id = t.employee_id)
              )
          )
          SELECT DISTINCT * FROM team ORDER BY name`;
        res.json(rows);
      } else {
        res.json(await sql`
          SELECT * FROM employees
          WHERE reporting_manager_id = ANY(${cands}::text[])
            AND NULLIF(TRIM(reporting_manager_id), '') IS NOT NULL
          ORDER BY name`);
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
    const { name, email, phone, department, designation, join_date, location, manager, reporting_manager_id, status, salary, ctc, biometric_id, shift, next_appraisal_month, next_appraisal_year, date_of_birth, exit_date, exit_salary_override } = req.body;
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`.catch(()=>{});
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_date DATE`.catch(()=>{});
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS exit_salary_override NUMERIC`.catch(()=>{});
    // Normalize override: empty string / undefined → NULL (use auto math).
    // Numeric → store as-is. Negative gets coerced to 0 so the rollup
    // never goes the wrong direction.
    const overrideVal = (exit_salary_override === undefined || exit_salary_override === null || exit_salary_override === '' )
      ? null
      : Math.max(0, Number(exit_salary_override));
    const rows = await sql`
      UPDATE employees SET name=${name}, email=${email}, phone=${phone}, department=${department},
        designation=${designation}, join_date=${join_date || null},
        location=${location}, manager=${manager ?? null},
        reporting_manager_id=${reporting_manager_id ?? null},
        status=${status}, salary=${salary}, ctc=${ctc},
        biometric_id=${biometric_id ?? null}, shift=${shift ?? 'day'},
        next_appraisal_month=${next_appraisal_month ?? null}, next_appraisal_year=${next_appraisal_year ?? null},
        date_of_birth=${date_of_birth || null},
        exit_date=${exit_date || null},
        exit_salary_override=${overrideVal}
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

    // Block extension clock-in ONLY while the biometric session is still
    // open (check_out is null) — i.e. the employee hasn't biometric-clocked-
    // out yet. After biometric clock-out, the office portion is sealed and
    // the extension can take over for any remaining work (e.g. went home
    // and continued from there). Without this, an employee who biometric'd
    // in at 9, biometric'd out at 6, and wanted to continue WFH at 8pm
    // got a hard 409 from the extension and couldn't log the second block.
    const existingRec = await sql`SELECT source, check_out FROM attendance_records WHERE employee_id=${employee_id} AND date::date=${today}::date`;
    const recRow = (existingRec as any[])[0];
    if (recRow && recRow.source === 'biometric' && !recRow.check_out) {
      return res.status(409).json({ error: 'Biometric session still open — please biometric-clock-out at the office first.' });
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

  // Hard timeout on the upstream call. Without this, a slow eTimeOffice
  // server can hang the whole sync past Vercel's function timeout, taking
  // down the cron without leaving an error row in attendance_sync_log
  // (the catch only runs once the promise rejects).
  const fetchCtl = AbortSignal.timeout(20_000);
  const fetchRes = await fetch(
    `${apiUrl}?Empcode=ALL&FromDate=${toEt(from)}&ToDate=${toEt(to)}`,
    {
      headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
      signal: fetchCtl,
    }
  ).catch((e: any) => {
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
      throw new Error('eTimeOffice API timed out after 20s');
    }
    throw e;
  });
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

  // Bulk pre-load: every row we need to read is fetched in two queries
  // (one for existing attendance, one for approved WFH overrides). The
  // previous version issued ~3 SQL round-trips per biometric record,
  // which for ~30 employees × 2 days of data routinely exceeded
  // Vercel's 10s function budget and silently killed the cron.
  const recipientIds = new Set<string>();
  const recipientDates = new Set<string>();
  const cleaned: Array<{ iid: string; recDate: string; inTime: string|null; outTime: string|null; status: string; hours: number|null }> = [];

  for (const rec of records) {
    const empCode = String(rec.Empcode ?? '').trim();
    if (!empCode) continue;
    const iid = empMap.get(empCode) ?? empMap.get(empCode.replace(/^0+/, '') || '0');
    if (!iid) continue;
    const rawDs = String(rec.DateString ?? '').trim();
    let recDate = today;
    if (rawDs.includes('/')) { const [rdd,rmm,ry]=rawDs.split('/'); recDate=`${ry}-${rmm}-${rdd}`; }
    if (recDate > today) continue;
    if (isWeekendV(recDate)) continue;
    const inTime  = parseEtTimeV(rec.INTime);
    const outTime = parseEtTimeV(rec.OUTTime);
    const empShift = shiftMap.get(iid) ?? 'day';
    const lateAfter = shiftLateAfter[empShift] ?? '10:00';
    const status  = inTime
      ? (isLateByTime(inTime, lateAfter) ? 'late' : 'present')
      : (ET_STATUS_MAP[(rec.Status??'A').toUpperCase()] ?? 'absent');
    if (status === 'holiday' && !inTime) continue;
    const hours = parseEtWorkTimeV(rec.WorkTime);
    cleaned.push({ iid, recDate, inTime, outTime, status, hours });
    recipientIds.add(iid);
    recipientDates.add(recDate);
  }

  if (cleaned.length === 0) {
    await sql`INSERT INTO attendance_sync_log (sync_id,triggered,triggered_by,date_range,records_updated,records_created,status)
      VALUES(${syncId},${trigger},${triggeredBy??null},${label},0,0,'success')`;
    return { sync_id: syncId, records_updated: 0, records_created: 0, synced_at: new Date().toISOString(), date_range: label };
  }

  // One bulk SELECT for everything we need to dedupe against.
  const idsArr = Array.from(recipientIds);
  const datesArr = Array.from(recipientDates);
  const [wfhRows, existingRows] = await Promise.all([
    sql`SELECT employee_id, date::text AS date FROM wfh_requests
        WHERE employee_id = ANY(${idsArr}::text[])
          AND date::date = ANY(${datesArr}::date[])
          AND status='approved'` as Promise<any[]>,
    sql`SELECT employee_id, date::text AS date, status, check_in, check_out, total_hours
        FROM attendance_records
        WHERE employee_id = ANY(${idsArr}::text[])
          AND date = ANY(${datesArr}::date[])` as Promise<any[]>,
  ]);
  const wfhKey = (eid: string, d: string) => `${eid}|${d}`;
  const wfhSet = new Set<string>(wfhRows.map((r: any) => wfhKey(r.employee_id, r.date)));
  const existingMap = new Map<string, any>(existingRows.map((r: any) => [wfhKey(r.employee_id, r.date), r]));

  // Materialize the rows we'll actually insert/upsert, dropping anything
  // the WFH override claims.
  const finalRows = cleaned.filter(r => !wfhSet.has(wfhKey(r.iid, r.recDate)));
  if (finalRows.length === 0) {
    await sql`INSERT INTO attendance_sync_log (sync_id,triggered,triggered_by,date_range,records_updated,records_created,status)
      VALUES(${syncId},${trigger},${triggeredBy??null},${label},0,0,'success')`;
    return { sync_id: syncId, records_updated: 0, records_created: 0, synced_at: new Date().toISOString(), date_range: label };
  }

  // Bulk INSERT the snapshots in one round-trip via UNNEST. Each row's
  // status_before / *_before columns come from the existingMap pre-load.
  const snapEmps    = finalRows.map(r => r.iid);
  const snapDates   = finalRows.map(r => r.recDate);
  const snapHad     = finalRows.map(r => existingMap.has(wfhKey(r.iid, r.recDate)));
  const snapStatusB = finalRows.map(r => existingMap.get(wfhKey(r.iid, r.recDate))?.status ?? null);
  const snapInB     = finalRows.map(r => existingMap.get(wfhKey(r.iid, r.recDate))?.check_in ?? null);
  const snapOutB    = finalRows.map(r => existingMap.get(wfhKey(r.iid, r.recDate))?.check_out ?? null);
  const snapHrsB    = finalRows.map(r => existingMap.get(wfhKey(r.iid, r.recDate))?.total_hours ?? null);
  await sql`
    INSERT INTO attendance_sync_snapshot (sync_id,employee_id,date,had_record,status_before,check_in_before,check_out_before,total_hours_before)
    SELECT ${syncId}, e, d::date, had, sb, ib, ob, hb
    FROM UNNEST(
      ${snapEmps}::text[],
      ${snapDates}::text[],
      ${snapHad}::boolean[],
      ${snapStatusB}::text[],
      ${snapInB}::text[],
      ${snapOutB}::text[],
      ${snapHrsB}::numeric[]
    ) AS t(e, d, had, sb, ib, ob, hb)`;

  // Bulk UPSERT attendance_records. Counts are derived afterwards by
  // diffing finalRows against existingMap so we don't need the
  // (xmax=0) RETURNING trick which doesn't work well with UNNEST.
  const upEmps   = finalRows.map(r => r.iid);
  const upDates  = finalRows.map(r => r.recDate);
  const upIn     = finalRows.map(r => r.inTime);
  const upOut    = finalRows.map(r => r.outTime);
  const upStatus = finalRows.map(r => r.status);
  const upHours  = finalRows.map(r => r.hours);
  await sql`
    INSERT INTO attendance_records (employee_id, date, check_in, check_out, status, total_hours, source, biometric_sync_id)
    SELECT e, d::date, ci, co, st, hr, 'biometric', ${syncId}
    FROM UNNEST(
      ${upEmps}::text[],
      ${upDates}::text[],
      ${upIn}::text[],
      ${upOut}::text[],
      ${upStatus}::text[],
      ${upHours}::numeric[]
    ) AS t(e, d, ci, co, st, hr)
    ON CONFLICT (employee_id, date) DO UPDATE SET
      check_in = EXCLUDED.check_in,
      check_out = EXCLUDED.check_out,
      status = EXCLUDED.status,
      total_hours = EXCLUDED.total_hours,
      source = 'biometric',
      biometric_sync_id = EXCLUDED.biometric_sync_id`;
  const created = finalRows.filter(r => !existingMap.has(wfhKey(r.iid, r.recDate))).length;
  const updated = finalRows.length - created;

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

async function computePulseForDate(asOf: string, employeeIdsFilter?: string[] | null) {
  // Calendar-month window: first day of asOf's month → asOf (inclusive).
  // Early in the month this means little data; that's OK — it represents
  // the month-to-date honestly. The Manager Pulse rolling-4-weeks window
  // (below) stays cross-boundary, since weekly ratings don't reset at month-start.
  const asOfDate = new Date(asOf);
  const windowStart = new Date(Date.UTC(asOfDate.getUTCFullYear(), asOfDate.getUTCMonth(), 1));
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  // Pulse rating cutoff (last 4 weeks)
  const pulseStart = new Date(asOf);
  pulseStart.setUTCDate(pulseStart.getUTCDate() - 28);
  const pulseStartStr = pulseStart.toISOString().slice(0, 10);

  const _phase: Record<string, number> = {};
  let _t = Date.now();

  // Sharded compute: when employeeIdsFilter is provided, every WHERE clause
  // narrows to those IDs (plus the reporting-manager chain for stewardship).
  // This is how the frontend stays under Vercel's 10s function timeout —
  // each request handles ~5 employees, finishing in well under a second.
  const filter = employeeIdsFilter && employeeIdsFilter.length > 0 ? employeeIdsFilter : null;
  // For team-stewardship we also need the direct reports of any manager in
  // the chunk — even if they're not in the chunk themselves — so the
  // approval timeliness math has the data it needs.
  let extendedIds = filter;
  if (filter) {
    const repsOfManagers = (await sql`
      SELECT id FROM employees WHERE reporting_manager_id = ANY(${filter}::text[])`) as any[];
    const extras = repsOfManagers.map(r => r.id);
    if (extras.length) extendedIds = [...new Set([...filter, ...extras])];
  }
  const fIds = filter;
  const eIds = extendedIds;

  // All upfront SELECTs in parallel. Each is narrowed by the employee filter
  // when set — so a chunk of 5 fetches ~5 employees' worth of data instead
  // of the whole org. Round-trip count is unchanged (1 wall-clock); payload
  // size and Lambda CPU drop drastically.
  const [
    employees, attendance, leaves, hourDays, hourLogs,
    goals, upsells, pulseRatings, assignments, activeProjects, internalDays,
    reportingGraphRows, wfhRows, monthlyPerfRows,
  ] = await Promise.all([
    fIds
      ? sql`SELECT e.id, e.name, e.department, e.reporting_manager_id, e.join_date, e.shift, e.status, u.role
            FROM employees e LEFT JOIN app_users u ON u.employee_id_ref = e.id
            WHERE e.id = ANY(${fIds}::text[]) AND (e.status = 'active' OR e.status IS NULL)`
      : sql`SELECT e.id, e.name, e.department, e.reporting_manager_id, e.join_date, e.shift, e.status, u.role
            FROM employees e LEFT JOIN app_users u ON u.employee_id_ref = e.id
            WHERE e.status = 'active' OR e.status IS NULL`,
    eIds
      ? sql`SELECT employee_id, date, status, check_in, total_hours FROM attendance_records
            WHERE employee_id = ANY(${eIds}::text[])
              AND date BETWEEN ${windowStartStr}::date AND ${asOf}::date`
      : sql`SELECT employee_id, date, status, check_in, total_hours FROM attendance_records
            WHERE date BETWEEN ${windowStartStr}::date AND ${asOf}::date`,
    // Leaves: pulled for the WHOLE org (not chunk-filtered). Needs to cover
    //   discipline check  → leaves whose period overlaps the window, and
    //   stewardship check → leaves the manager/HR ACTIONED in the window
    //                        (manager_approved_at or hr_actioned_at recent).
    sql`SELECT employee_id, employee_name, from_date, to_date, status, applied_on,
               manager_id, manager_status, manager_approved_at,
               hr_actioner_name, hr_actioned_at
        FROM leave_requests
        WHERE NOT (to_date < ${windowStartStr}::date OR from_date > ${asOf}::date)
           OR applied_on             >= ${windowStartStr}::date
           OR manager_approved_at    >= ${windowStartStr}::date
           OR hr_actioned_at         >= ${windowStartStr}::date`,
    eIds
      ? sql`SELECT employee_id, project_id, log_date, hours, notes, created_at FROM hour_log_days
            WHERE employee_id = ANY(${eIds}::text[])
              AND log_date BETWEEN ${windowStartStr}::date AND ${asOf}::date`
      : sql`SELECT employee_id, project_id, log_date, hours, notes, created_at FROM hour_log_days
            WHERE log_date BETWEEN ${windowStartStr}::date AND ${asOf}::date`,
    // hourLogs powers approval-rate math AND stewardship; we need all logs
    // approved by anyone in the chunk, regardless of whose log it was. Cheap
    // table; no filter saves complexity.
    sql`SELECT employee_id, status, reviewed_at, submitted_at, hours_logged, reviewed_by_id FROM hour_logs
        WHERE submitted_at >= ${windowStartStr}::date`,
    eIds
      ? sql`SELECT employee_id, status, progress, target_date FROM performance_goals
            WHERE employee_id = ANY(${eIds}::text[])
              AND (created_at >= ${windowStartStr}::date OR (target_date IS NULL OR target_date >= ${windowStartStr}::date))`
      : sql`SELECT employee_id, status, progress, target_date FROM performance_goals
            WHERE created_at >= ${windowStartStr}::date OR (target_date IS NULL OR target_date >= ${windowStartStr}::date)`,
    eIds
      ? sql`SELECT employee_id, status, created_at FROM upsell_requests
            WHERE employee_id = ANY(${eIds}::text[]) AND created_at >= ${windowStartStr}::date`
      : sql`SELECT employee_id, status, created_at FROM upsell_requests
            WHERE created_at >= ${windowStartStr}::date`,
    eIds
      ? sql`SELECT employee_id, rating, week_start FROM performance_manager_pulse
            WHERE employee_id = ANY(${eIds}::text[]) AND week_start >= ${pulseStartStr}::date`
      : sql`SELECT employee_id, rating, week_start FROM performance_manager_pulse
            WHERE week_start >= ${pulseStartStr}::date`,
    sql`SELECT project_id, employee_id, month, year, monthly_hours FROM project_assignments
        WHERE monthly_hours > 0`,
    sql`SELECT id, project_reporting_id, project_lead_id, created_by FROM projects WHERE status='active'`,
    // Pulse counts ONLY approved internal-hours toward hours hygiene —
    // pending submissions don't credit until the manager signs off.
    eIds
      ? sql`SELECT employee_id, log_date, hours, notes FROM internal_hour_logs
            WHERE employee_id = ANY(${eIds}::text[])
              AND log_date BETWEEN ${windowStartStr}::date AND ${asOf}::date
              AND status='approved'`
      : sql`SELECT employee_id, log_date, hours, notes FROM internal_hour_logs
            WHERE log_date BETWEEN ${windowStartStr}::date AND ${asOf}::date
              AND status='approved'`,
    // Full reporting graph (id, manager) for every active employee. Needed
    // for Team Stewardship: a manager in the chunk needs to know who reports
    // to them even if those reports aren't in this chunk. Cheap query, two
    // columns, hundreds of rows max — keeps the chunked path correct.
    sql`SELECT id, reporting_manager_id FROM employees
        WHERE reporting_manager_id IS NOT NULL
          AND COALESCE(status, 'active') = 'active'`,
    // WFH requests — for the approval timing factor in Team Stewardship
    // (both manager step and HR step). Cheap table, no chunk filter needed.
    sql`SELECT id, employee_id, employee_name, status, applied_on,
               manager_id, manager_status, manager_approved_at,
               hr_actioner_name, hr_actioned_at
        FROM wfh_requests
        WHERE applied_on             >= ${windowStartStr}::date
           OR manager_approved_at    >= ${windowStartStr}::date
           OR hr_actioned_at         >= ${windowStartStr}::date`,
    // Monthly performance for the last 3 months — feeds two new things:
    //   1. Team Stewardship's review_timeliness: did manager submit
    //      prior-month reviews for their reports by day 5?
    //   2. Client Handling pillar: latest client_satisfaction score.
    // 3-month window is enough to catch missing prior-month reviews and to
    // smooth a stale most-recent rating.
    sql`SELECT employee_id, reviewer_id, month, year, client_satisfaction, overall_score, created_at
        FROM monthly_performance
        WHERE (year * 12 + month) >= (
          (EXTRACT(YEAR FROM ${asOf}::date)::int * 12 + EXTRACT(MONTH FROM ${asOf}::date)::int) - 3
        )`,
  ]) as any[][];
  _phase.reads = Date.now() - _t; _t = Date.now();

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
  const internalByEmp = new Map<string, any[]>();
  internalDays.forEach(r => { (internalByEmp.get(r.employee_id) ?? internalByEmp.set(r.employee_id, []).get(r.employee_id))!.push(r); });
  // Monthly performance: by (employee_id, year, month) — for the review
  // timeliness check; and by employee_id (most recent) — for client_handling.
  const perfByEmpMonth = new Map<string, any>();
  const perfByEmp = new Map<string, any[]>();
  (monthlyPerfRows as any[]).forEach(r => {
    perfByEmpMonth.set(`${r.employee_id}|${r.year}|${r.month}`, r);
    const arr = perfByEmp.get(r.employee_id) ?? [];
    arr.push(r); perfByEmp.set(r.employee_id, arr);
  });

  // helpers
  const workingDays = (() => {
    let d = new Date(windowStartStr);
    const end = new Date(asOf);
    let c = 0;
    while (d <= end) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) c++; d.setUTCDate(d.getUTCDate() + 1); }
    return Math.max(1, c);
  })();

  const empById = new Map(employees.map(e => [e.id, e]));
  // Org-wide direct-reports lookup. Built from the full reporting graph so a
  // manager in this chunk sees ALL their reports, not just those that
  // happen to also be in the chunk. Without this, stewardship was always
  // 0 for managers whose reports landed in other chunks.
  const reportsByMgr = new Map<string, any[]>();
  (reportingGraphRows as any[]).forEach(e => {
    const arr = reportsByMgr.get(e.reporting_manager_id) ?? [];
    arr.push({ id: e.id });
    reportsByMgr.set(e.reporting_manager_id, arr);
  });

  _phase.indexes = Date.now() - _t; _t = Date.now();

  const snapshots: Array<{ employee_id: string; pillars: any; total: number; band: string; baseline: boolean; breakdown: any }> = [];

  for (const emp of employees) {
    const empId = emp.id;
    const isNewJoiner = emp.join_date && (new Date(asOf).getTime() - new Date(emp.join_date).getTime()) / 86400000 < 30;

    // ── Discipline ────────────────────────────────────────────────────
    // Late arrivals deliberately don't penalise — the org calls these out
    // separately, and traffic / shift slack made the 5-point/late hit feel
    // punitive. Absences (15 pts each) + leave-without-notice (20 pts each)
    // still count.
    const att = attByEmp.get(empId) ?? [];
    let absences = 0;
    for (const a of att) {
      if (a.status === 'absent') absences++;
    }
    // Leave-without-notice: leave applied <= day of from_date
    const lwn = (leaveByEmp.get(empId) ?? []).filter(l => {
      if (!l.applied_on || !l.from_date) return false;
      return new Date(l.applied_on).toISOString().slice(0, 10) >= String(l.from_date).slice(0, 10);
    }).length;
    const discipline = clamp(100 - absences * 15 - lwn * 20, 0, 100);

    // ── Hours hygiene ─────────────────────────────────────────────────
    // A day "counts as logged" if there's EITHER a project hour-day entry
    // OR an internal-activity log for that date. Same for notes.
    const hd = hdByEmp.get(empId) ?? [];
    const id_ = internalByEmp.get(empId) ?? [];
    const daysLoggedSet = new Set([
      ...hd.map(r => String(r.log_date).slice(0, 10)),
      ...id_.map(r => String(r.log_date).slice(0, 10)),
    ]);
    const daysWithNotesSet = new Set([
      ...hd.filter(r => (r.notes ?? '').trim().length > 0).map(r => String(r.log_date).slice(0, 10)),
      ...id_.filter(r => (r.notes ?? '').trim().length > 0).map(r => String(r.log_date).slice(0, 10)),
    ]);
    const daysLogged = daysLoggedSet.size;
    const daysWithNotes = daysWithNotesSet.size;
    const hh = clamp((daysLogged / workingDays) * 70 + (daysLogged ? (daysWithNotes / daysLogged) * 30 : 0), 0, 100);

    // ── Output ────────────────────────────────────────────────────────
    // Measures what the employee actually controls: did they log against
    // their allocation, and did managers approve those logs. Unallocated
    // employees (HR, recruiters, between-projects) get null — pillar
    // weight redistributes. Penalising someone for not having work
    // assigned is the company's failure, not the employee's.
    const hl = hlByEmp.get(empId) ?? [];
    const projectHrsLogged = hd.reduce((s, r) => s + Number(r.hours ?? 0), 0);
    const internalHrsLogged = id_.reduce((s, r) => s + Number(r.hours ?? 0), 0);
    // Allocation for the window's months. Most cases collapse to current
    // month; mid-month-spanning windows pick up both.
    const winMonths = new Set<string>();
    {
      const d = new Date(windowStartStr);
      const end = new Date(asOf);
      while (d <= end) {
        winMonths.add(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);
        d.setUTCDate(d.getUTCDate() + 7);
      }
    }
    const allocatedHours = assignments
      .filter(a => a.employee_id === empId && winMonths.has(`${a.year}-${a.month}`))
      .reduce((s, a) => s + Number(a.monthly_hours ?? 0), 0);

    let output: number | null = null;
    let outputDetail: any;
    const approved = hl.filter(r => r.status === 'approved').length;
    const submitted = hl.filter(r => r.status !== 'pending').length;
    const approvalRate = submitted ? (approved / submitted) * 100 : 100;
    if (allocatedHours > 0) {
      // Did they log their allocation? Capped at 100 so over-logging doesn't
      // dominate; the surplus instead feeds the extra-effort bonus.
      const allocPct = clamp((projectHrsLogged / allocatedHours) * 100, 0, 100);
      // Extra effort = project hours beyond allocation + internal hours.
      // Bonus capped at 20 pts — pushes a strong contributor from 80 → 100
      // but can't paper over a missed allocation.
      const overAllocHrs = Math.max(0, projectHrsLogged - allocatedHours);
      const bonusHrs = overAllocHrs + internalHrsLogged;
      const bonusPts = clamp((bonusHrs / Math.max(allocatedHours * 0.25, 1)) * 20, 0, 20);
      output = clamp(allocPct * 0.7 + approvalRate * 0.3 + bonusPts, 0, 100);
      outputDetail = {
        allocated_hours: Math.round(allocatedHours),
        project_logged: Math.round(projectHrsLogged),
        internal_logged: Math.round(internalHrsLogged),
        allocation_pct: Math.round(allocPct),
        approval_rate_pct: Math.round(approvalRate),
        extra_effort_bonus: Math.round(bonusPts),
      };
    } else {
      // Not allocated this window — Output pillar skipped, weight redistributes.
      output = null;
      outputDetail = {
        allocated_hours: 0,
        project_logged: Math.round(projectHrsLogged),
        internal_logged: Math.round(internalHrsLogged),
        no_allocation: true,
      };
    }

    // ── Contribution ──────────────────────────────────────────────────
    // Upsells only. Goals were dropped — goal progress is too admin-
    // dependent and uneven across roles to score against. Baseline 60
    // for everyone, each non-rejected upsell adds 10 pts, capped at 100.
    const upsellCount = (upsellByEmp.get(empId) ?? []).filter(u => u.status !== 'rejected').length;
    const contribution = clamp(60 + upsellCount * 10, 0, 100);

    // ── Manager pulse ─────────────────────────────────────────────────
    const pulses = pulseByEmp.get(empId) ?? [];
    const pulseScores = pulses.map(p => p.rating === 'good' ? 100 : p.rating === 'ok' ? 60 : 20);
    const managerPulse = pulseScores.length >= 2
      ? pulseScores.reduce((s, n) => s + n, 0) / pulseScores.length
      : null;

    // ── Team stewardship (managers only) ──────────────────────────────
    // Three components:
    //   approval timeliness — unified across hour-log + leave (manager step)
    //                         + leave (HR step) + WFH manager + WFH HR.
    //                         hour-logs: 48h target. Leaves / WFH: 24h
    //                         target (same-day). Used for both reporting
    //                         managers AND HR (who do the HR-step actions).
    //   team logging hygiene — avg of reports' days-logged %
    //   review timeliness   — % of reports with prior-month review by day 5
    //
    // Gating expands to include HR/admin even without direct reports:
    //   directReports.length > 0  OR  role in (hr_manager, admin)
    // For HR with no team, team_logging_hygiene + review_timeliness skip,
    // pillar effectively becomes 100% approval timeliness.
    const directReports = reportsByMgr.get(empId) ?? [];
    const isApprover = directReports.length > 0
      || emp.role === 'hr_manager'
      || emp.role === 'admin';
    let teamStewardship: number | null = null;
    let stewardshipDetail: any = null;
    if (isApprover) {
      // ── 1. Unified approval timeliness ─────────────────────────────
      let timelyCount = 0, totalCount = 0;
      let detailHL = { total: 0, timely: 0 };
      let detailLM = { total: 0, timely: 0 };
      let detailLH = { total: 0, timely: 0 };
      let detailWM = { total: 0, timely: 0 };
      let detailWH = { total: 0, timely: 0 };
      // Hour-log approvals (48h target)
      const myHourApprovals = hourLogs.filter(r => r.reviewed_by_id === empId && r.status === 'approved');
      for (const a of myHourApprovals) {
        if (!a.reviewed_at || !a.submitted_at) continue;
        detailHL.total++; totalCount++;
        const dh = (new Date(a.reviewed_at).getTime() - new Date(a.submitted_at).getTime()) / 3600000;
        if (dh <= 48) { detailHL.timely++; timelyCount++; }
      }
      // Leave manager step (24h)
      for (const l of leaves) {
        if (l.manager_id !== empId || !l.manager_approved_at) continue;
        detailLM.total++; totalCount++;
        const dh = (new Date(l.manager_approved_at).getTime() - new Date(l.applied_on).getTime()) / 3600000;
        if (dh <= 24) { detailLM.timely++; timelyCount++; }
      }
      // Leave HR step (24h from when it reached HR = manager_approved_at)
      for (const l of leaves) {
        if (l.hr_actioner_name !== emp.name || !l.hr_actioned_at || !l.manager_approved_at) continue;
        detailLH.total++; totalCount++;
        const dh = (new Date(l.hr_actioned_at).getTime() - new Date(l.manager_approved_at).getTime()) / 3600000;
        if (dh <= 24) { detailLH.timely++; timelyCount++; }
      }
      // WFH manager step (24h)
      for (const w of wfhRows) {
        if (w.manager_id !== empId || !w.manager_approved_at) continue;
        detailWM.total++; totalCount++;
        const dh = (new Date(w.manager_approved_at).getTime() - new Date(w.applied_on).getTime()) / 3600000;
        if (dh <= 24) { detailWM.timely++; timelyCount++; }
      }
      // WFH HR step (24h)
      for (const w of wfhRows) {
        if (w.hr_actioner_name !== emp.name || !w.hr_actioned_at || !w.manager_approved_at) continue;
        detailWH.total++; totalCount++;
        const dh = (new Date(w.hr_actioned_at).getTime() - new Date(w.manager_approved_at).getTime()) / 3600000;
        if (dh <= 24) { detailWH.timely++; timelyCount++; }
      }
      const approvalTimely = totalCount ? (timelyCount / totalCount) * 100 : 100;

      // ── 2. Team logging hygiene (manager-only sub-factor) ──────────
      let teamHygiene: number | null = null;
      if (directReports.length > 0) {
        const teamHh: number[] = [];
        for (const r of directReports) {
          const rhd = hdByEmp.get(r.id) ?? [];
          const dl = new Set(rhd.map(x => String(x.log_date).slice(0, 10))).size;
          teamHh.push((dl / workingDays) * 100);
        }
        teamHygiene = teamHh.length ? teamHh.reduce((s, n) => s + n, 0) / teamHh.length : 0;
      }

      // ── 3. Review timeliness (manager-only, active day 5+ of month) ──
      const asOfDate = new Date(asOf);
      const dayOfMonth = asOfDate.getUTCDate();
      let reviewTimely: number | null = null;
      let reviewedCount = 0;
      let missingReports: string[] = [];
      if (directReports.length > 0 && dayOfMonth >= 5) {
        const prevMonth = asOfDate.getUTCMonth() === 0 ? 12 : asOfDate.getUTCMonth();
        const prevYear  = asOfDate.getUTCMonth() === 0 ? asOfDate.getUTCFullYear() - 1 : asOfDate.getUTCFullYear();
        for (const r of directReports) {
          const has = perfByEmpMonth.has(`${r.id}|${prevYear}|${prevMonth}`);
          if (has) reviewedCount++;
          else missingReports.push(r.id);
        }
        reviewTimely = directReports.length ? (reviewedCount / directReports.length) * 100 : 100;
      }

      // ── Aggregate — only the components that apply ─────────────────
      const components: Array<{ value: number; weight: number }> = [];
      components.push({ value: approvalTimely,   weight: reviewTimely != null ? 35 : (teamHygiene != null ? 50 : 100) });
      if (teamHygiene != null)   components.push({ value: teamHygiene,    weight: reviewTimely != null ? 35 : 50 });
      if (reviewTimely != null)  components.push({ value: reviewTimely,   weight: 30 });
      const totalWeight = components.reduce((s, c) => s + c.weight, 0);
      teamStewardship = clamp(components.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight, 0, 100);

      stewardshipDetail = {
        approval_timeliness: Math.round(approvalTimely),
        approvals_made: totalCount,
        approvals_breakdown: {
          hour_logs: detailHL,
          leave_manager: detailLM,
          leave_hr: detailLH,
          wfh_manager: detailWM,
          wfh_hr: detailWH,
        },
        team_logging_hygiene: teamHygiene != null ? Math.round(teamHygiene) : null,
        team_size: directReports.length,
        review_timeliness: reviewTimely != null ? Math.round(reviewTimely) : null,
        reviews_done: reviewTimely != null ? reviewedCount : null,
        reviews_missing_count: reviewTimely != null ? missingReports.length : null,
        review_check_active: reviewTimely != null,
        role_scope: directReports.length > 0 ? 'manager' : (emp.role === 'hr_manager' ? 'hr' : 'admin'),
      };
    }

    // ── Client Handling (managers + coordinators + admins) ────────────
    // Sourced from monthly_performance.client_satisfaction — the rating
    // their reviewer gives them each month on messaging, handling tough
    // clients, interaction quality, retention. Latest row wins.
    // For ICs and anyone without client-facing role: pillar redistributes.
    let clientHandling: number | null = null;
    let clientHandlingDetail: any = null;
    const handlesClients = directReports.length > 0
      || emp.role === 'project_coordinator'
      || emp.role === 'admin';
    if (handlesClients) {
      const perfList = (perfByEmp.get(empId) ?? []).slice().sort((a: any, b: any) =>
        (b.year * 12 + b.month) - (a.year * 12 + a.month)
      );
      const latest = perfList[0];
      if (latest && latest.client_satisfaction != null) {
        clientHandling = clamp(Number(latest.client_satisfaction), 0, 100);
        clientHandlingDetail = {
          latest_score: Math.round(clientHandling),
          rated_month: `${latest.year}-${String(latest.month).padStart(2, '0')}`,
          source: 'monthly_performance.client_satisfaction',
        };
      } else {
        // Eligible but never rated — pillar redistributes; UI hints why.
        clientHandlingDetail = { no_rating_yet: true };
      }
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
      client_handling: clientHandling,
    };
    const present = Object.entries(pillars).filter(([, v]) => v != null) as [string, number][];
    const total = present.length ? present.reduce((s, [, v]) => s + v, 0) / present.length : 0;
    const rounded = Math.round(total);

    const breakdown: any = {
      discipline_misses: { absences, leave_without_notice: lwn },
      hygiene: { working_days: workingDays, days_logged: daysLogged, days_with_notes: daysWithNotes },
      output_detail: outputDetail,
      contribution_detail: { upsells: upsellCount },
      manager_pulse_detail: { ratings_in_window: pulses.length, avg: managerPulse != null ? Math.round(managerPulse) : null },
      team_stewardship_detail: stewardshipDetail,
      project_hygiene_detail: projHygieneDetail,
      client_handling_detail: clientHandlingDetail,
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
        client_handling: clientHandling != null ? Math.round(clientHandling) : null,
      },
      total: rounded,
      band: isNewJoiner ? 'baseline' : bandFor(rounded),
      baseline: !!isNewJoiner,
      breakdown,
    });
  }

  _phase.loop = Date.now() - _t; _t = Date.now();
  // Batched upsert — one round-trip for all snapshots. Previously 35 sequential
  // INSERTs over HTTP took ~7s and pushed past the 10s function timeout.
  if (snapshots.length > 0) {
    const payload = snapshots.map(s => ({
      employee_id: s.employee_id,
      discipline: s.pillars.discipline,
      hours_hygiene: s.pillars.hours_hygiene,
      output: s.pillars.output,
      contribution: s.pillars.contribution,
      manager_pulse: s.pillars.manager_pulse,
      team_stewardship: s.pillars.team_stewardship,
      project_hygiene: s.pillars.project_hygiene,
      client_handling: s.pillars.client_handling,
      total_score: s.total,
      band: s.band,
      is_baseline: s.baseline,
      breakdown: s.breakdown,
    }));
    await sql`
      INSERT INTO performance_score_snapshots
        (employee_id, snapshot_date, discipline, hours_hygiene, output, contribution,
         manager_pulse, team_stewardship, project_hygiene, client_handling,
         total_score, band, is_baseline, breakdown)
      SELECT
        employee_id, ${asOf}::date,
        discipline, hours_hygiene, output, contribution,
        manager_pulse, team_stewardship, project_hygiene, client_handling,
        total_score, band, is_baseline, breakdown
      FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS x(
        employee_id text,
        discipline numeric, hours_hygiene numeric, output numeric, contribution numeric,
        manager_pulse numeric, team_stewardship numeric, project_hygiene numeric, client_handling numeric,
        total_score numeric, band text, is_baseline boolean, breakdown jsonb
      )
      ON CONFLICT (employee_id, snapshot_date) DO UPDATE SET
        discipline=EXCLUDED.discipline, hours_hygiene=EXCLUDED.hours_hygiene,
        output=EXCLUDED.output, contribution=EXCLUDED.contribution,
        manager_pulse=EXCLUDED.manager_pulse, team_stewardship=EXCLUDED.team_stewardship,
        project_hygiene=EXCLUDED.project_hygiene, client_handling=EXCLUDED.client_handling,
        total_score=EXCLUDED.total_score,
        band=EXCLUDED.band, is_baseline=EXCLUDED.is_baseline, breakdown=EXCLUDED.breakdown`;
  }
  _phase.writeSnaps = Date.now() - _t; _t = Date.now();

  // Skip notification side-effects on chunked recomputes — each chunk would
  // otherwise re-fire drop nudges and weekly digests. Notifications belong
  // to the nightly cron path (single full pass per day).
  if (filter) {
    _phase.notify = 0;
    return { computed: snapshots.length, as_of: asOf, phases: _phase };
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

  _phase.notify = Date.now() - _t;

  return { computed: snapshots.length, as_of: asOf, phases: _phase };
}

// ─────────────────────────────────────────────────────────────────────────
// Monthly snapshot closing. Picks each employee's LATEST daily snapshot
// in the given month and copies it to performance_monthly_snapshots.
// Idempotent — ON CONFLICT updates so re-closing a month overwrites with
// the freshest values (useful if the month closes mid-day and a final
// recompute lands later).
// ─────────────────────────────────────────────────────────────────────────
async function closeMonthlyPulse(month: number, year: number): Promise<{ closed: number }> {
  await ensurePulseReady();
  const rows = await sql`
    INSERT INTO performance_monthly_snapshots
      (employee_id, month, year, total_score, band, discipline, hours_hygiene, output, contribution,
       manager_pulse, team_stewardship, project_hygiene, client_handling, is_baseline, breakdown)
    SELECT DISTINCT ON (employee_id)
      employee_id, ${month}, ${year}, total_score, band, discipline, hours_hygiene, output, contribution,
      manager_pulse, team_stewardship, project_hygiene, client_handling, is_baseline, breakdown
    FROM performance_score_snapshots
    WHERE EXTRACT(YEAR FROM snapshot_date) = ${year}
      AND EXTRACT(MONTH FROM snapshot_date) = ${month}
    ORDER BY employee_id, snapshot_date DESC
    ON CONFLICT (employee_id, month, year) DO UPDATE SET
      total_score      = EXCLUDED.total_score,
      band             = EXCLUDED.band,
      discipline       = EXCLUDED.discipline,
      hours_hygiene    = EXCLUDED.hours_hygiene,
      output           = EXCLUDED.output,
      contribution     = EXCLUDED.contribution,
      manager_pulse    = EXCLUDED.manager_pulse,
      team_stewardship = EXCLUDED.team_stewardship,
      project_hygiene  = EXCLUDED.project_hygiene,
      client_handling  = EXCLUDED.client_handling,
      is_baseline      = EXCLUDED.is_baseline,
      breakdown        = EXCLUDED.breakdown,
      closed_at        = NOW()
    RETURNING employee_id` as any[];
  return { closed: rows.length };
}

// Auto-close the previous month if today is day 1 and it isn't closed yet.
// Runs at the start of the daily cron path so the just-finished month gets
// booked before the new daily recompute starts overwriting today's row.
async function autoCloseLastMonthIfDue(): Promise<{ closed?: number; month?: number; year?: number } | null> {
  const today = new Date();
  if (today.getUTCDate() !== 1) return null;
  const prev = new Date(today);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const m = prev.getUTCMonth() + 1;
  const y = prev.getUTCFullYear();
  // Skip if already closed (someone could have called the manual endpoint).
  const exists = (await sql`
    SELECT 1 FROM performance_monthly_snapshots
    WHERE month=${m} AND year=${y} LIMIT 1`)[0] as any;
  if (exists) return null;
  const r = await closeMonthlyPulse(m, y);
  return { ...r, month: m, year: y };
}

// Cron entry point — Vercel hits this nightly. Reuses CRON_SECRET / x-vercel-cron auth.
app.all('/api/performance/pulse/cron', async (req, res) => {
  try {
    const auth = req.header('authorization') || '';
    const platformCron = !!req.header('x-vercel-cron');
    const secret = process.env.CRON_SECRET;
    const okToken = secret ? auth === `Bearer ${secret}` : false;
    if (!okToken && !platformCron) return res.status(401).json({ error: 'Unauthorized' });
    await ensurePulseReady();
    // Close the previous month FIRST (if today is day 1 and it hasn't been
    // closed yet). The previous month should be booked using its own latest
    // snapshot, not contaminated by the new day's compute that's about to run.
    const closed = await autoCloseLastMonthIfDue().catch(() => null);
    const today = new Date().toISOString().slice(0, 10);
    const result = await computePulseForDate(today);
    res.json({ ...result, monthly_close: closed });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Pulse compute failed' });
  }
});

// Manual recompute (admin only — used while developing or after a backfill).
// Runs migrations defensively in case this is the first hit since deploy and
// the pulse tables haven't been created yet — saves a "why is it empty?"
// debugging round-trip.
app.post('/api/performance/pulse/recompute', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  try {
    await ensurePulseReady();
    // Best-effort link any unlinked user accounts to employee records by
    // email/name. Runs once per recompute call. Cheap (idempotent UPDATEs)
    // and means newly-onboarded users see their pulse without an extra
    // admin step.
    const healed = await healUserEmployeeLinks();
    if ((healed.linkedByEmail + healed.linkedByName) > 0) {
      timings.healedLinks = healed.linkedByEmail + healed.linkedByName;
    }
    timings.ensureReadyMs = Date.now() - t0;
    const asOf = (req.body?.as_of as string) || new Date().toISOString().slice(0, 10);
    // Shard: when employee_ids is provided, only those employees are computed.
    // Frontend chunks the work to stay under Vercel's 10s function timeout.
    const employeeIds: string[] | null = Array.isArray(req.body?.employee_ids) && req.body.employee_ids.length
      ? req.body.employee_ids : null;
    const tCompute = Date.now();
    const result = await computePulseForDate(asOf, employeeIds);
    timings.computeMs = Date.now() - tCompute;
    timings.totalMs = Date.now() - t0;
    res.json({ ...result, timings });
  } catch (err: any) {
    timings.totalMs = Date.now() - t0;
    res.status(500).json({ error: err.message ?? 'Recompute failed', timings });
  }
});

// Returns the ordered list of employee IDs the frontend should chunk over.
// Cheap query; admins call this once before starting the chunked recompute.
app.get('/api/performance/pulse/recompute-targets', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await ensurePulseReady();
    const rows = await sql`
      SELECT id FROM employees
      WHERE COALESCE(status, 'active') = 'active'
      ORDER BY id` as any[];
    res.json({ employee_ids: rows.map(r => r.id) });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});

// ── Monthly snapshots ───────────────────────────────────────────────────
// Manual close — admin can book a given month's pulse closing on demand.
// Useful for backfill: run once per past month to seed history from the
// daily snapshots that already exist.
app.post('/api/performance/pulse/monthly/close', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await ensurePulseReady();
    const { month, year } = req.body ?? {};
    const m = Number(month), y = Number(year);
    if (!m || !y || m < 1 || m > 12) return res.status(400).json({ error: 'month (1-12) and year are required' });
    const r = await closeMonthlyPulse(m, y);
    res.json({ ...r, month: m, year: y });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Close failed' }); }
});

// Role-scoped monthly history.
//   admin / hr_manager / project_coordinator → any employee_id (or org-wide)
//   reporting manager → their direct reports + their own
//   anyone else → their own only
app.get('/api/performance/pulse/monthly', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    await ensurePulseReady();
    const u = (await sql`SELECT id, name, email, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const isOrgViewer = u.role === 'admin' || u.role === 'hr_manager' || u.role === 'project_coordinator';
    const viewerEmpId = await resolveUserToEmployee(u);
    // Period filter — default last 6 months ending this month.
    const today = new Date();
    const months = Number(req.query.months) > 0 ? Math.min(24, Number(req.query.months)) : 6;
    const filterEmpId = (req.query.employee_id as string) || null;

    // Allowed employee ids
    let allowedIds: string[] | null = null; // null = all (org viewer)
    if (!isOrgViewer) {
      const ids: string[] = [];
      if (viewerEmpId) {
        ids.push(viewerEmpId);
        const reports = await sql`SELECT id FROM employees WHERE reporting_manager_id=${viewerEmpId}`;
        for (const r of reports as any[]) ids.push(r.id);
      }
      allowedIds = ids;
    }
    if (filterEmpId) {
      if (allowedIds && !allowedIds.includes(filterEmpId)) return res.status(403).json({ error: 'Not permitted' });
      allowedIds = [filterEmpId];
    }

    // Period start = months ago, day 1
    const startDate = new Date(today);
    startDate.setUTCDate(1);
    startDate.setUTCMonth(startDate.getUTCMonth() - (months - 1));
    const startM = startDate.getUTCMonth() + 1;
    const startY = startDate.getUTCFullYear();
    const endM = today.getUTCMonth() + 1;
    const endY = today.getUTCFullYear();

    const rows = await (allowedIds
      ? sql`SELECT s.*, e.name, e.department, e.designation
            FROM performance_monthly_snapshots s
            JOIN employees e ON e.id = s.employee_id
            WHERE s.employee_id = ANY(${allowedIds}::text[])
              AND (s.year > ${startY} OR (s.year = ${startY} AND s.month >= ${startM}))
              AND (s.year < ${endY} OR (s.year = ${endY} AND s.month <= ${endM}))
            ORDER BY e.name, s.year DESC, s.month DESC`
      : sql`SELECT s.*, e.name, e.department, e.designation
            FROM performance_monthly_snapshots s
            JOIN employees e ON e.id = s.employee_id
            WHERE (s.year > ${startY} OR (s.year = ${startY} AND s.month >= ${startM}))
              AND (s.year < ${endY} OR (s.year = ${endY} AND s.month <= ${endM}))
            ORDER BY e.name, s.year DESC, s.month DESC`) as any[];
    res.json({ months, rows });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// Pulse access helper:
//   admin/hr_manager  → any employee
//   the employee     → their own
//   reporting manager (direct OR through chain) → their report's
// Resolve an app_user row to a current employee.id. Same three-tier
// resolution as /me — explicit linkage (if it still points to an existing
// employee) → email match → name match. Returns null if none of the three
// resolve. Used by /me, /team, /pulse/:employeeId access check.
async function resolveUserToEmployee(u: any): Promise<string | null> {
  // Returns employees.id (internal), which is what snapshots are keyed by.
  // employee_id_ref stores the HUMAN code (DL0067 etc); we look up by it
  // first, then fall back to email/name match.
  const ref = u?.employee_id_ref ?? null;
  if (ref) {
    // Match either column — defensive for legacy rows where ref might still
    // be an internal id from before the migration ran.
    const row = (await sql`
      SELECT id FROM employees
      WHERE employee_id = ${ref} OR id = ${ref}
      LIMIT 1`)[0] as any;
    if (row?.id) return row.id;
  }
  if (u?.email) {
    const m = (await sql`SELECT id FROM employees WHERE LOWER(email)=LOWER(${u.email}) LIMIT 1`)[0] as any;
    if (m?.id) return m.id;
  }
  if (u?.name) {
    const m = (await sql`SELECT id FROM employees WHERE LOWER(name)=LOWER(${u.name}) LIMIT 1`)[0] as any;
    if (m?.id) return m.id;
  }
  return null;
}

async function canViewPulse(viewer: any, targetEmpId: string): Promise<boolean> {
  if (!viewer) return false;
  if (viewer.role === 'admin' || viewer.role === 'hr_manager' || viewer.role === 'project_coordinator') return true;
  const viewerEmpId = await resolveUserToEmployee(viewer);
  if (!viewerEmpId) return false;
  if (viewerEmpId === targetEmpId) return true;
  // walk up reporting chain
  let cur = targetEmpId;
  for (let i = 0; i < 10; i++) {
    const row = (await sql`SELECT reporting_manager_id FROM employees WHERE id=${cur}`)[0] as any;
    if (!row?.reporting_manager_id) return false;
    if (row.reporting_manager_id === viewerEmpId) return true;
    cur = row.reporting_manager_id;
  }
  return false;
}

// Single source of truth for "the score for this employee in this period".
//   no month/year, OR current month → latest daily snapshot (live month-to-date)
//   past month → the closed monthly_snapshots row
// Returns the snapshot in the same shape regardless of source, so callers
// don't need to branch on it.
async function getPulseSnapshotForPeriod(employeeId: string, month?: number | null, year?: number | null) {
  const now = new Date();
  const currentM = now.getUTCMonth() + 1;
  const currentY = now.getUTCFullYear();
  if (!month || !year || (month === currentM && year === currentY)) {
    return (await sql`
      SELECT * FROM performance_score_snapshots
      WHERE employee_id=${employeeId}
      ORDER BY snapshot_date DESC LIMIT 1`)[0] ?? null;
  }
  const row = (await sql`
    SELECT * FROM performance_monthly_snapshots
    WHERE employee_id=${employeeId} AND month=${month} AND year=${year}`)[0] as any;
  if (!row) return null;
  // Synthesise a snapshot_date so the UI can format "Updated MMM YYYY".
  // Use month-end (or asOf if it's mid-current-month).
  const monthEnd = new Date(Date.UTC(year, month, 0));
  return { ...row, snapshot_date: monthEnd.toISOString().slice(0, 10) };
}

// GET /api/performance/pulse/me — last snapshot + 8-week trend for current user
app.get('/api/performance/pulse/me', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, email, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });

    const empId = await resolveUserToEmployee(u);
    // Compute resolved_via after the fact so the response still surfaces it
    // for DevTools-side debugging. Matches whichever of the three paths the
    // shared helper actually used.
    const resolvedVia: 'linkage' | 'email' | 'name' | 'none' =
      empId == null ? 'none'
      : (u.employee_id_ref && empId === u.employee_id_ref) ? 'linkage'
      : (u.email) ? 'email'
      : 'name';
    if (!empId) {
      // Still no match — return null gracefully so the Hub shows the
      // placeholder rather than a silent 404. Include a diagnostic field
      // so we can surface "user not linked to an employee" in the UI.
      return res.json({ latest: null, trend: [], resolved_via: 'none', user_name: u.name });
    }

    let latest: any = null; let trend: any[] = [];
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;
    try {
      latest = await getPulseSnapshotForPeriod(empId, month, year);
      // Trend stays as the 8-week daily trace — it's a visualisation of
      // recent progress, independent of which month the headline number is for.
      trend = await sql`
        SELECT snapshot_date, total_score, band FROM performance_score_snapshots
        WHERE employee_id=${empId} AND snapshot_date >= (CURRENT_DATE - INTERVAL '56 days')
        ORDER BY snapshot_date ASC` as any[];
    } catch { /* table missing — return null and let the UI prompt to recompute */ }
    // Surface the resolved linkage so admin can spot bad/missing links from
    // DevTools without spelunking the DB.
    let linkedEmployee: any = null;
    if (empId) {
      const row = (await sql`SELECT id, name, email, status FROM employees WHERE id=${empId}`)[0] as any;
      if (row) linkedEmployee = { id: row.id, name: row.name, email: row.email, status: row.status };
    }
    res.json({ latest, trend, resolved_via: resolvedVia, linked_employee: linkedEmployee });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/performance/pulse/team — current user's direct reports' latest scores
app.get('/api/performance/pulse/team', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, email, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const mgrEmpId = await resolveUserToEmployee(u);
    if (!mgrEmpId) return res.json({ team: [], week_start: null });
    // Cheap existence check; avoid running 60 CREATE statements on every team load.
    await ensurePulseReady();
    // Period filter: ?month=&year= picks a past month from monthly snapshots.
    // Current/no period defaults to the latest daily snapshot (month-to-date).
    const reqMonth = req.query.month ? Number(req.query.month) : null;
    const reqYear  = req.query.year  ? Number(req.query.year)  : null;
    const now = new Date();
    const isCurrent = !reqMonth || !reqYear ||
      (reqMonth === now.getUTCMonth() + 1 && reqYear === now.getUTCFullYear());
    const team = isCurrent ? await sql`
      SELECT e.id, e.name, e.avatar, e.department, e.designation,
             s.total_score, s.band, s.discipline, s.hours_hygiene, s.output, s.contribution,
             s.manager_pulse, s.team_stewardship, s.project_hygiene, s.client_handling, s.is_baseline, s.snapshot_date
      FROM employees e
      LEFT JOIN LATERAL (
        SELECT * FROM performance_score_snapshots
        WHERE employee_id=e.id ORDER BY snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE e.reporting_manager_id=${mgrEmpId} AND COALESCE(e.status,'active')='active'
      ORDER BY s.total_score DESC NULLS LAST, e.name` as any[]
      : await sql`
      SELECT e.id, e.name, e.avatar, e.department, e.designation,
             s.total_score, s.band, s.discipline, s.hours_hygiene, s.output, s.contribution,
             s.manager_pulse, s.team_stewardship, s.project_hygiene, s.client_handling, s.is_baseline,
             (s.year || '-' || LPAD(s.month::text, 2, '0') || '-01')::date AS snapshot_date
      FROM employees e
      LEFT JOIN performance_monthly_snapshots s
        ON s.employee_id = e.id AND s.month=${reqMonth} AND s.year=${reqYear}
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
    if (!u || !['admin', 'hr_manager', 'project_coordinator'].includes(u.role)) return res.status(403).json({ error: 'Admin / HR / Coordinator only' });
    await ensurePulseReady();
    const reqMonth = req.query.month ? Number(req.query.month) : null;
    const reqYear  = req.query.year  ? Number(req.query.year)  : null;
    const now = new Date();
    const isCurrent = !reqMonth || !reqYear ||
      (reqMonth === now.getUTCMonth() + 1 && reqYear === now.getUTCFullYear());
    const rows = isCurrent ? await sql`
      SELECT e.id, e.name, e.avatar, e.department, e.designation, e.reporting_manager_id,
             m.name AS reporting_manager_name,
             s.total_score, s.band, s.discipline, s.hours_hygiene, s.output, s.contribution,
             s.manager_pulse, s.team_stewardship, s.project_hygiene, s.client_handling, s.is_baseline, s.snapshot_date
      FROM employees e
      LEFT JOIN employees m ON m.id = e.reporting_manager_id
      LEFT JOIN LATERAL (
        SELECT * FROM performance_score_snapshots
        WHERE employee_id=e.id ORDER BY snapshot_date DESC LIMIT 1
      ) s ON TRUE
      WHERE COALESCE(e.status,'active')='active'
      ORDER BY s.total_score DESC NULLS LAST, e.name` as any[]
      : await sql`
      SELECT e.id, e.name, e.avatar, e.department, e.designation, e.reporting_manager_id,
             m.name AS reporting_manager_name,
             s.total_score, s.band, s.discipline, s.hours_hygiene, s.output, s.contribution,
             s.manager_pulse, s.team_stewardship, s.project_hygiene, s.client_handling, s.is_baseline,
             (s.year || '-' || LPAD(s.month::text, 2, '0') || '-01')::date AS snapshot_date
      FROM employees e
      LEFT JOIN employees m ON m.id = e.reporting_manager_id
      LEFT JOIN performance_monthly_snapshots s
        ON s.employee_id = e.id AND s.month=${reqMonth} AND s.year=${reqYear}
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
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;
    const latest = await getPulseSnapshotForPeriod(req.params.employeeId, month, year);
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
app.get('/api/performance/pulse/weights', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    await ensurePulseReady();
    const rows = await sql`SELECT * FROM performance_score_weights ORDER BY department`;
    res.json({ weights: rows });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});
app.put('/api/performance/pulse/weights/:dept', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
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

// ─────────────────────────────────────────────────────────────────────────
// Internal activities + non-project hour logging.
// Activities are admin-managed. Hour logs are self-reported (no approval).
// ─────────────────────────────────────────────────────────────────────────
app.get('/api/internal-activities', async (req, res) => {
  try {
    await runStartupMigrations();
    const u = (await sql`SELECT role, employee_id_ref FROM app_users WHERE id=${req.header('x-user-id') ?? ''}`)[0] as any;
    // Admin / HR see the whole catalogue (including inactive rows so they
    // can re-activate / clean up). Everyone else only sees active rows
    // scoped to their effective roles.
    const isAdminOrHR = u?.role === 'admin' || u?.role === 'hr_manager';
    if (isAdminOrHR) {
      const rows = await sql`SELECT * FROM internal_activities ORDER BY sort_order, name`;
      return res.json(rows);
    }
    // Build the user's effective-roles set. Always includes their primary
    // role; adds 'manager' if they have any direct reports. Empty when we
    // can't resolve them — returns NULL-roles activities only (the "all
    // hands" set), so they at least see the unscoped defaults.
    const effective: string[] = [];
    if (u?.role) effective.push(u.role);
    if (u?.employee_id_ref) {
      const meRow = (await sql`
        SELECT id FROM employees
        WHERE employee_id = ${u.employee_id_ref} OR id = ${u.employee_id_ref}
        LIMIT 1`)[0] as any;
      if (meRow?.id) {
        const hasReports = (await sql`
          SELECT 1 FROM employees WHERE reporting_manager_id = ${meRow.id} LIMIT 1`) as any[];
        if (hasReports.length) effective.push('manager');
      }
    }
    const rows = await sql`
      SELECT * FROM internal_activities
      WHERE active = TRUE
        AND (
          roles IS NULL
          OR cardinality(roles) = 0
          OR roles && ${effective}::text[]
        )
      ORDER BY sort_order, name`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});
// Sanitize a roles input: must be an array of known role strings. Empty
// arrays are coerced to NULL so the GET filter treats it as "visible to
// everyone" (rather than the technically-correct "visible to nobody").
const VALID_ACTIVITY_ROLES = new Set(['admin', 'hr_manager', 'project_coordinator', 'manager', 'employee']);
function normalizeActivityRoles(input: any): string[] | null {
  if (!Array.isArray(input)) return null;
  const cleaned = input
    .map(r => String(r).trim())
    .filter(r => VALID_ACTIVITY_ROLES.has(r));
  return cleaned.length ? Array.from(new Set(cleaned)) : null;
}

app.post('/api/internal-activities', async (req, res) => {
  try {
    await runStartupMigrations();
    if (!(await requireAdmin(req, res))) return;
    const { name, description, sort_order, roles } = req.body ?? {};
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    const cleanedRoles = normalizeActivityRoles(roles);
    const id = `act_${Date.now()}`;
    const row = (await sql`
      INSERT INTO internal_activities (id, name, description, sort_order, created_by, roles)
      VALUES (${id}, ${name.trim()}, ${description?.trim() || null}, ${Number(sort_order) || 100}, ${req.header('x-user-id') ?? null}, ${cleanedRoles}::text[])
      RETURNING *`)[0];
    res.status(201).json(row);
  } catch (err: any) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'An activity with that name already exists' });
    res.status(500).json({ error: err.message ?? 'Server error' });
  }
});
app.put('/api/internal-activities/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const { name, description, active, sort_order, roles } = req.body ?? {};
    // roles is intentionally three-state: undefined → don't touch; null →
    // clear (visible to all); array → set. Use a separate UPDATE for that
    // column to keep the COALESCE pattern simple for the others.
    const row = (await sql`
      UPDATE internal_activities SET
        name=COALESCE(${name?.trim() || null}, name),
        description=${description ?? null},
        active=COALESCE(${active ?? null}, active),
        sort_order=COALESCE(${sort_order ?? null}, sort_order)
      WHERE id=${req.params.id}
      RETURNING *`)[0];
    if (!row) return res.status(404).json({ error: 'Activity not found' });
    if (roles !== undefined) {
      const cleanedRoles = roles === null ? null : normalizeActivityRoles(roles);
      const updated = (await sql`
        UPDATE internal_activities SET roles=${cleanedRoles}::text[]
        WHERE id=${req.params.id}
        RETURNING *`)[0];
      return res.json(updated);
    }
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});
app.delete('/api/internal-activities/:id', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    // Soft-delete: mark inactive so historical logs still resolve their
    // activity name. Hard delete would orphan the logs.
    await sql`UPDATE internal_activities SET active=FALSE WHERE id=${req.params.id}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────
// To-Do tasks. Each employee owns a list. Tasks can be created by self OR
// by their reporting manager / HR / admin. Creators always see what they've
// assigned alongside their own tasks so they can follow up.
// ─────────────────────────────────────────────────────────────────────────

// Helper: who is allowed to assign tasks TO `targetEmpId`?
// Self (always), the target's reporting manager (direct or sub-tree), HR, admin.
async function canAssignToEmployee(actorUser: any, actorEmpId: string | null, targetEmpId: string): Promise<boolean> {
  if (!actorUser) return false;
  if (actorUser.role === 'admin' || actorUser.role === 'hr_manager') return true;
  if (actorEmpId && actorEmpId === targetEmpId) return true; // self
  if (!actorEmpId) return false;
  // walk up the target's reporting chain — if actor appears, allow
  let cur = targetEmpId;
  for (let i = 0; i < 10; i++) {
    const row = (await sql`SELECT reporting_manager_id FROM employees WHERE id=${cur}`)[0] as any;
    if (!row?.reporting_manager_id) return false;
    if (row.reporting_manager_id === actorEmpId) return true;
    cur = row.reporting_manager_id;
  }
  return false;
}

// GET /api/todos — returns both my own tasks and tasks I created for others.
// Optional ?status=&assignee_id=&view=mine|assigned-by-me|all
app.get('/api/todos', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, email, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const empId = await resolveUserToEmployee(u);
    if (!empId) return res.json({ mine: [], assigned_by_me: [] });
    const status = (req.query.status as string) || null;
    const mine = status
      ? await sql`SELECT * FROM todo_tasks WHERE assignee_id=${empId} AND status=${status} ORDER BY
                   CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                   COALESCE(due_date, '9999-12-31'::date), created_at DESC`
      : await sql`SELECT * FROM todo_tasks WHERE assignee_id=${empId} ORDER BY
                   CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                   COALESCE(due_date, '9999-12-31'::date), created_at DESC`;
    const assignedByMe = status
      ? await sql`SELECT * FROM todo_tasks WHERE created_by_id=${empId} AND assignee_id <> ${empId} AND status=${status}
                  ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                           COALESCE(due_date, '9999-12-31'::date), created_at DESC`
      : await sql`SELECT * FROM todo_tasks WHERE created_by_id=${empId} AND assignee_id <> ${empId}
                  ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                           COALESCE(due_date, '9999-12-31'::date), created_at DESC`;
    res.json({ mine, assigned_by_me: assignedByMe });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// POST /api/todos — create a task. If assignee_id is omitted or equals the
// actor's employee id, it's a personal task. Otherwise it's assigned to
// someone else and requires the right relationship.
app.post('/api/todos', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, email, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const actorEmpId = await resolveUserToEmployee(u);
    if (!actorEmpId) return res.status(400).json({ error: 'No employee profile linked to this user' });

    const { assignee_id: rawAssignee, title, description, due_date, priority } = req.body ?? {};
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    const assigneeId = rawAssignee?.trim() || actorEmpId;

    if (assigneeId !== actorEmpId) {
      const ok = await canAssignToEmployee(u, actorEmpId, assigneeId);
      if (!ok) return res.status(403).json({ error: 'You can only assign tasks to yourself or to people you manage.' });
    }
    const assignee = (await sql`SELECT name FROM employees WHERE id=${assigneeId}`)[0] as any;
    if (!assignee) return res.status(404).json({ error: 'Assignee not found' });

    const role = assigneeId === actorEmpId ? 'self' : (u.role || 'manager');
    const id = `todo_${Date.now()}`;
    const row = (await sql`
      INSERT INTO todo_tasks
        (id, assignee_id, assignee_name, created_by_id, created_by_name, created_by_role,
         title, description, due_date, priority)
      VALUES (${id}, ${assigneeId}, ${assignee.name}, ${actorEmpId}, ${u.name}, ${role},
              ${title.trim()}, ${description?.trim() || null}, ${due_date || null},
              ${priority || 'normal'})
      RETURNING *`)[0];

    // Notify the assignee when someone else assigns them a task.
    if (assigneeId !== actorEmpId) {
      notifyEmployeeUser(assigneeId, 'todo_assigned', `New task: ${title.trim().slice(0, 60)}`,
        `${u.name} added a task to your to-do list${due_date ? ` (due ${due_date})` : ''}.`).catch(()=>{});
    }
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PATCH /api/todos/:id — edit task or change status.
// Assignee can update status / completion_note.
// Creator + admin can edit title/description/due_date/priority/assignee.
app.patch('/api/todos/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, email, employee_id_ref, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const actorEmpId = await resolveUserToEmployee(u);
    const t = (await sql`SELECT * FROM todo_tasks WHERE id=${req.params.id}`)[0] as any;
    if (!t) return res.status(404).json({ error: 'Task not found' });

    const isAdmin = u.role === 'admin' || u.role === 'hr_manager';
    const isAssignee = actorEmpId === t.assignee_id;
    const isCreator  = actorEmpId === t.created_by_id;
    if (!isAdmin && !isAssignee && !isCreator) return res.status(403).json({ error: 'Not permitted' });

    const { title, description, due_date, priority, status, completion_note } = req.body ?? {};
    // Only creator/admin can edit content fields; assignee can only touch
    // status/note. Compute final values up-front so the SQL is straight COALESCEs.
    const canEditContent = isAdmin || isCreator;
    const finalTitle       = canEditContent && title != null ? title.trim() : t.title;
    const finalDescription = canEditContent && description !== undefined ? (description?.trim() || null) : t.description;
    const finalDueDate     = canEditContent && due_date !== undefined ? (due_date || null) : t.due_date;
    const finalPriority    = canEditContent && priority ? priority : t.priority;
    const finalStatus      = status ?? t.status;
    const finalNote        = completion_note !== undefined ? (completion_note?.trim() || null) : t.completion_note;
    // Completed_at follows status: set when transitioning to 'done', cleared
    // when moving back to anything else.
    const movedToDone = status === 'done' && t.status !== 'done';
    const movedFromDone = status && status !== 'done' && t.status === 'done';
    const row = (await sql`
      UPDATE todo_tasks SET
        title           = ${finalTitle},
        description     = ${finalDescription},
        due_date        = ${finalDueDate},
        priority        = ${finalPriority},
        status          = ${finalStatus},
        completion_note = ${finalNote},
        completed_at    = ${movedToDone ? new Date().toISOString() : movedFromDone ? null : t.completed_at},
        updated_at      = NOW()
      WHERE id=${req.params.id}
      RETURNING *`)[0];

    // Notify the creator when the assignee marks something done.
    if (movedToDone && t.created_by_id && t.created_by_id !== t.assignee_id) {
      notifyEmployeeUser(t.created_by_id, 'todo_completed', `Task done: ${t.title.slice(0, 60)}`,
        `${t.assignee_name ?? 'The assignee'} marked your assigned task as done.`).catch(()=>{});
    }
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// DELETE /api/todos/:id — creator or admin only.
app.delete('/api/todos/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role, employee_id_ref, name, email FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const actorEmpId = await resolveUserToEmployee(u);
    const t = (await sql`SELECT created_by_id, assignee_id FROM todo_tasks WHERE id=${req.params.id}`)[0] as any;
    if (!t) return res.status(404).json({ error: 'Task not found' });
    const isAdmin = u.role === 'admin' || u.role === 'hr_manager';
    if (!isAdmin && actorEmpId !== t.created_by_id) return res.status(403).json({ error: 'Only the creator or HR/admin can delete a task' });
    await sql`DELETE FROM todo_tasks WHERE id=${req.params.id}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────
// Feature announcements ("What's new")
// - Admin/HR can draft. Only admin can publish.
// - Once published, every user sees a one-time modal on their next page
//   load until they ack it. Acks are per-user, per-feature, idempotent.
// - Drafts and unpublished items are not visible to anyone outside admin/HR.
// ─────────────────────────────────────────────────────────────────────────

// Audience tags allowed on a feature announcement's target_roles. 'manager'
// is a pseudo-tag — matches any user who has at least one direct report,
// regardless of system role.
const FEATURE_AUDIENCE_TAGS = new Set(['admin', 'hr_manager', 'project_coordinator', 'employee', 'manager']);

// Resolve whether a user matches an announcement's target_roles. Empty /
// null target_roles = everyone. Otherwise OR semantics across the tags.
async function userMatchesFeatureAudience(u: any, targetRoles: string[] | null | undefined): Promise<boolean> {
  if (!u) return false;
  if (!targetRoles || targetRoles.length === 0) return true;
  if (targetRoles.includes(u.role)) return true;
  if (targetRoles.includes('manager')) {
    // Has direct reports? Walk employees.reporting_manager_id once.
    const empId = await resolveUserToEmployee(u);
    if (!empId) return false;
    const reports = await sql`SELECT 1 FROM employees WHERE reporting_manager_id=${empId} LIMIT 1`;
    if ((reports as any[]).length) return true;
  }
  return false;
}

// Normalize the array coming from the client — drop bad tags, dedupe, and
// return null when the array would be empty so DB stores NULL (= everyone)
// instead of an empty array (which would render badly in the admin UI).
function normalizeAudience(input: any): any {
  if (!Array.isArray(input)) return null;
  const filtered = Array.from(new Set(input.filter((t: any) => typeof t === 'string' && FEATURE_AUDIENCE_TAGS.has(t))));
  return filtered.length === 0 ? null : filtered;
}

// GET /api/features — returns the list, scoped by role.
//   admin / hr_manager → drafts + published (everything)
//   everyone else      → only published items, plus a "seen" flag per item
//                        so a What's-new page can render history with a
//                        "NEW" badge on unseen rows.
app.get('/api/features', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const isAdminish = u.role === 'admin' || u.role === 'hr_manager';
    if (isAdminish) {
      const rows = await sql`SELECT * FROM feature_announcements ORDER BY
                              CASE status WHEN 'draft' THEN 0 ELSE 1 END,
                              COALESCE(published_at, updated_at) DESC`;
      return res.json(rows);
    }
    const rows = await sql`
      SELECT f.*,
        (a.user_id IS NOT NULL) AS seen
      FROM feature_announcements f
      LEFT JOIN feature_acks a ON a.feature_id = f.id AND a.user_id = ${uid}
      WHERE f.status = 'published'
      ORDER BY f.published_at DESC`;
    // Audience filter — non-admin viewers only see announcements they
    // actually match. Done in JS for the same reason as /unseen above.
    const filtered = [];
    for (const r of (rows as any[])) {
      if (await userMatchesFeatureAudience(u, r.target_roles)) filtered.push(r);
    }
    res.json(filtered);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/features/unseen — the FIRST published feature the current user
// hasn't acknowledged yet. The popup component polls this on mount; if it's
// null, nothing pops. We return one at a time so multiple announcements
// surface as a stack (close one, the next pops on the next render cycle).
app.get('/api/features/unseen', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    // Pull all unseen published features for this user — we then filter
    // by audience in JS so the JSONB containment + manager-pseudo logic
    // stays out of SQL. Limit a bit higher than 1 to keep the query
    // efficient while leaving headroom for skipped non-matches.
    const rows = await sql`
      SELECT f.* FROM feature_announcements f
      WHERE f.status = 'published'
        AND NOT EXISTS (
          SELECT 1 FROM feature_acks a
          WHERE a.feature_id = f.id AND a.user_id = ${uid}
        )
      ORDER BY f.published_at ASC
      LIMIT 20`;
    for (const r of (rows as any[])) {
      if (await userMatchesFeatureAudience(u, r.target_roles)) {
        return res.json(r);
      }
    }
    res.json(null);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// POST /api/features — create a new draft. Admin or HR.
app.post('/api/features', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (u.role !== 'admin' && u.role !== 'hr_manager') return res.status(403).json({ error: 'Admin or HR only' });
    const { title, body, image_url, cta_label, cta_url, target_roles } = req.body ?? {};
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Title and body are required' });
    const audience = normalizeAudience(target_roles);
    const id = `feat_${Date.now()}`;
    const row = (await sql`
      INSERT INTO feature_announcements (id, title, body, image_url, cta_label, cta_url, target_roles, drafted_by_id, drafted_by_name)
      VALUES (${id}, ${title.trim()}, ${body.trim()}, ${image_url || null}, ${cta_label || null}, ${cta_url || null},
              ${audience === null ? null : JSON.stringify(audience)}::jsonb,
              ${u.id}, ${u.name})
      RETURNING *`)[0];
    // Ping admins so they know a new draft is waiting for review.
    notifyAdminsAndHR('feature_draft', 'New feature draft awaiting approval',
      `${u.name} drafted "${title.trim().slice(0, 80)}". Open Features to review and publish.`).catch(()=>{});
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PATCH /api/features/:id — edit or publish.
//   - status='published' requires admin (HR can draft but not push).
//   - editing content while still a draft is open to admin + HR.
//   - editing content AFTER publish is admin-only (it goes out to everyone).
app.patch('/api/features/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const isAdmin = u.role === 'admin';
    const isHR    = u.role === 'hr_manager';
    if (!isAdmin && !isHR) return res.status(403).json({ error: 'Admin or HR only' });
    const cur = (await sql`SELECT * FROM feature_announcements WHERE id=${req.params.id}`)[0] as any;
    if (!cur) return res.status(404).json({ error: 'Feature not found' });
    const { title, body, image_url, cta_label, cta_url, status, target_roles } = req.body ?? {};
    const goingLive   = status === 'published' && cur.status !== 'published';
    const goingDraft  = status === 'draft' && cur.status === 'published';
    if ((goingLive || goingDraft) && !isAdmin) {
      return res.status(403).json({ error: 'Only admin can publish or unpublish' });
    }
    if (cur.status === 'published' && !isAdmin) {
      return res.status(403).json({ error: 'Only admin can edit a published announcement' });
    }
    const finalStatus = status ?? cur.status;
    // Audience is optional on the PATCH — only overwrite if the caller
    // actually sent the field. Lets a publish flip happen without
    // re-asserting the audience.
    const audienceUpdated = target_roles !== undefined;
    const audience = audienceUpdated ? normalizeAudience(target_roles) : null;
    const row = (await sql`
      UPDATE feature_announcements SET
        title       = ${title?.trim() ?? cur.title},
        body        = ${body?.trim() ?? cur.body},
        image_url   = ${image_url !== undefined ? (image_url || null) : cur.image_url},
        cta_label   = ${cta_label !== undefined ? (cta_label || null) : cur.cta_label},
        cta_url     = ${cta_url !== undefined ? (cta_url || null) : cur.cta_url},
        target_roles= ${audienceUpdated ? (audience === null ? null : JSON.stringify(audience)) : null}::jsonb,
        status      = ${finalStatus},
        approved_by_id   = ${goingLive ? u.id : cur.approved_by_id},
        approved_by_name = ${goingLive ? u.name : cur.approved_by_name},
        approved_at      = ${goingLive ? new Date().toISOString() : cur.approved_at},
        published_at     = ${goingLive ? new Date().toISOString() : (goingDraft ? null : cur.published_at)},
        updated_at       = NOW()
      WHERE id=${req.params.id}
      RETURNING *`)[0];
    // Special-case the COALESCE pattern: when audience isn't being
    // updated, keep the old value. Done as a separate UPDATE because the
    // tagged-template + ::jsonb cast trick above can't easily express
    // "keep existing JSONB". Quick second hop is fine.
    if (!audienceUpdated) {
      await sql`UPDATE feature_announcements SET target_roles=${cur.target_roles === null ? null : JSON.stringify(cur.target_roles)}::jsonb WHERE id=${req.params.id}`;
      row.target_roles = cur.target_roles;
    }

    if (goingLive) {
      // Broadcast the bell ping to users who match the audience.
      // Replaced the per-user JS loop (which did N+1 queries via
      // userMatchesFeatureAudience and felt like a hang on Publish) with
      // a single SQL query that resolves the recipient set + a single
      // bulk INSERT into notifications. ~30 users now resolves in
      // ~50-100ms instead of 5-10s of round-trips.
      try {
        const tags: string[] = Array.isArray(row.target_roles) ? row.target_roles : [];
        const baseRoles = tags.filter(t => t !== 'manager');
        const includeManagers = tags.includes('manager');
        const everyone = tags.length === 0;
        const recipients = everyone
          ? await sql`SELECT id FROM app_users WHERE active = TRUE`
          : await sql`
              SELECT DISTINCT u.id
              FROM app_users u
              LEFT JOIN employees e ON e.employee_id = u.employee_id_ref
              WHERE u.active = TRUE
                AND (
                  u.role = ANY(${baseRoles}::text[])
                  OR (${includeManagers}::boolean AND e.id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM employees r WHERE r.reporting_manager_id = e.id
                  ))
                )`;
        const userIds = (recipients as any[]).map(r => r.id);
        if (userIds.length > 0) {
          const titleStr = `New feature: ${row.title.slice(0, 80)}`;
          const bodyStr  = row.body.slice(0, 200);
          // Single INSERT spans all recipients via UNNEST. One round-trip
          // even for hundreds of users.
          await sql`
            INSERT INTO notifications (user_id, type, title, body)
            SELECT u, 'feature_published', ${titleStr}, ${bodyStr}
            FROM UNNEST(${userIds}::text[]) AS u
          `;
        }
      } catch {}
    }
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// DELETE /api/features/:id — admin only.
app.delete('/api/features/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (u.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    await sql`DELETE FROM feature_acks WHERE feature_id=${req.params.id}`.catch(()=>{});
    await sql`DELETE FROM feature_announcements WHERE id=${req.params.id}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// POST /api/features/:id/ack — current user dismisses the popup. Idempotent
// thanks to ON CONFLICT DO NOTHING + the composite PK on (user_id,
// feature_id) — double-clicks or stale tabs can hammer this with no harm.
app.post('/api/features/:id/ack', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    await sql`
      INSERT INTO feature_acks (user_id, feature_id)
      VALUES (${uid}, ${req.params.id})
      ON CONFLICT (user_id, feature_id) DO NOTHING`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────
// Company announcements — general news / updates / policy reminders that
// appear on the Dashboard widget for anyone signed in. Separate from
// feature_announcements which is for HRMS product changes only.
// Admin / HR can create, edit, delete. Everyone can read.
// ─────────────────────────────────────────────────────────────────────────

app.get('/api/announcements', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    // Lazy auto-post pass — runs every fetch but is fully idempotent. The
    // ON CONFLICT (id) DO NOTHING covers the no-cron case on Vercel Hobby:
    // first read of the day creates today's birthday + anniversary cards;
    // subsequent reads are no-ops. Deterministic id keys per (employee,
    // date) prevent duplicates even across multiple concurrent fetches.
    // Wrapped in try/catch so a malformed employees row never breaks the
    // main list response.
    try {
      // Birthdays
      await sql`
        INSERT INTO company_announcements (id, title, body, kind, posted_by_name)
        SELECT
          'auto_bday_' || e.id || '_' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD'),
          '🎂 Happy birthday, ' || split_part(e.name, ' ', 1) || '!',
          'Wishing ' || e.name || COALESCE(' (' || e.designation || ')', '') || ' a wonderful birthday today. Drop a 🎉 in the comments and make their day!',
          'birthday',
          'Digital Leap HRMS'
        FROM employees e
        WHERE e.status = 'active'
          AND e.date_of_birth IS NOT NULL
          AND EXTRACT(MONTH FROM e.date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY FROM e.date_of_birth)   = EXTRACT(DAY FROM CURRENT_DATE)
        ON CONFLICT (id) DO NOTHING`.catch(()=>{});
      // Work anniversaries — only after the first year so the joining day
      // itself doesn't fire as "0 years".
      await sql`
        INSERT INTO company_announcements (id, title, body, kind, posted_by_name)
        SELECT
          'auto_anniv_' || e.id || '_' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD'),
          '🎯 ' || e.name || ' completes ' || (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM e.join_date))::int || ' year' ||
            CASE WHEN (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM e.join_date))::int = 1 THEN '' ELSE 's' END || ' today!',
          'Celebrating ' || e.name || COALESCE(' (' || e.designation || ')', '') || ' for being part of the team since ' || TO_CHAR(e.join_date, 'Mon YYYY') || '. Cheers to the journey 🥂',
          'anniversary',
          'Digital Leap HRMS'
        FROM employees e
        WHERE e.status = 'active'
          AND e.join_date IS NOT NULL
          AND EXTRACT(MONTH FROM e.join_date) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY FROM e.join_date)   = EXTRACT(DAY FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM CURRENT_DATE) > EXTRACT(YEAR FROM e.join_date)
        ON CONFLICT (id) DO NOTHING`.catch(()=>{});
    } catch {}

    // Active = not expired (expires_at is null or in the future). Pinned
    // sorts first, then newest first.
    const rows = await sql`
      SELECT * FROM company_announcements
      WHERE expires_at IS NULL OR expires_at > NOW()
      ORDER BY pinned DESC, created_at DESC
      LIMIT 50`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

app.post('/api/announcements', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    // Posting is open to every signed-in user. Pinning + expiry stay
    // restricted to admin/HR so an employee can't pin their own post to
    // the top of the org feed indefinitely.
    const isAdminOrHR = u.role === 'admin' || u.role === 'hr_manager';
    const { title, body, pinned, expires_at } = req.body ?? {};
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Title and body are required' });
    const id = `ann_${Date.now()}`;
    const row = (await sql`
      INSERT INTO company_announcements (id, title, body, pinned, expires_at, posted_by_id, posted_by_name, posted_by_role, kind)
      VALUES (${id}, ${title.trim()}, ${body.trim()}, ${isAdminOrHR ? !!pinned : false}, ${isAdminOrHR ? (expires_at || null) : null}, ${u.id}, ${u.name}, ${u.role}, 'user')
      RETURNING *`)[0];
    // Broadcast bell ping — every active user gets a notification.
    try {
      const users = (await sql`SELECT id FROM app_users WHERE active = TRUE`) as any[];
      const userIds = users.map(x => x.id);
      if (userIds.length > 0) {
        await sql`
          INSERT INTO notifications (user_id, type, title, body)
          SELECT u, 'company_announcement', ${`📢 ${title.trim().slice(0, 80)}`}, ${body.trim().slice(0, 200)}
          FROM UNNEST(${userIds}::text[]) AS u`;
      }
    } catch {}
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

app.patch('/api/announcements/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const cur = (await sql`SELECT * FROM company_announcements WHERE id=${req.params.id}`)[0] as any;
    if (!cur) return res.status(404).json({ error: 'Announcement not found' });
    const isAdminOrHR = u.role === 'admin' || u.role === 'hr_manager';
    const isOwnPost   = cur.posted_by_id === uid;
    if (!isAdminOrHR && !isOwnPost) return res.status(403).json({ error: 'You can only edit your own posts.' });
    const { title, body, pinned, expires_at } = req.body ?? {};
    // Pin / expiry remain admin/HR-only. Non-admin posters editing their
    // own posts can change title + body, but pin/expiry stay as they were.
    const row = (await sql`
      UPDATE company_announcements SET
        title      = ${title?.trim() ?? cur.title},
        body       = ${body?.trim() ?? cur.body},
        pinned     = ${isAdminOrHR && pinned !== undefined ? !!pinned : cur.pinned},
        expires_at = ${isAdminOrHR && expires_at !== undefined ? (expires_at || null) : cur.expires_at},
        updated_at = NOW()
      WHERE id=${req.params.id}
      RETURNING *`)[0];
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

app.delete('/api/announcements/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const cur = (await sql`SELECT posted_by_id, kind FROM company_announcements WHERE id=${req.params.id}`)[0] as any;
    if (!cur) return res.status(404).json({ error: 'Announcement not found' });
    const isAdminOrHR = u.role === 'admin' || u.role === 'hr_manager';
    const isOwnPost   = cur.posted_by_id === uid;
    // Anyone can delete their own post. Admin/HR can delete anyone's,
    // including auto-generated ones (e.g. if the celebrant prefers
    // privacy). Auto-posts have posted_by_id=NULL so the ownership check
    // alone excludes employees from removing system posts.
    if (!isAdminOrHR && !isOwnPost) return res.status(403).json({ error: 'You can only delete your own posts.' });
    await sql`DELETE FROM company_announcements WHERE id=${req.params.id}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ── Announcement comments ────────────────────────────────────────────────
// Flat thread under each announcement so the team can react / reply
// inline. Anyone signed in can post; admin / HR (or the comment author)
// can delete. No edit endpoint — keep the audit trail clean; if you
// want to change a comment, delete + repost.

// GET /api/announcements/:id/comments — chronological list.
app.get('/api/announcements/:id/comments', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const rows = await sql`
      SELECT * FROM announcement_comments
      WHERE announcement_id = ${req.params.id}
      ORDER BY created_at ASC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// POST /api/announcements/:id/comments — add one. Body { body }.
app.post('/api/announcements/:id/comments', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const ann = (await sql`SELECT id, title, posted_by_id FROM company_announcements WHERE id=${req.params.id}`)[0] as any;
    if (!ann) return res.status(404).json({ error: 'Announcement not found' });
    const { body } = req.body ?? {};
    if (!body?.trim()) return res.status(400).json({ error: 'Comment body required' });
    const id = `cmt_${Date.now()}`;
    const row = (await sql`
      INSERT INTO announcement_comments (id, announcement_id, body, posted_by_id, posted_by_name, posted_by_role)
      VALUES (${id}, ${req.params.id}, ${body.trim()}, ${u.id}, ${u.name}, ${u.role})
      RETURNING *`)[0];
    // Ping the original poster (if a human posted it and isn't the
    // commenter themselves). Auto-posts have posted_by_id=NULL so this
    // skips automatically for birthday/anniversary cards.
    if (ann.posted_by_id && ann.posted_by_id !== u.id) {
      sql`INSERT INTO notifications (user_id, type, title, body)
          VALUES (${ann.posted_by_id}, 'announcement_comment',
                  ${`💬 New comment on "${(ann.title ?? '').slice(0, 60)}"`},
                  ${`${u.name}: ${body.trim().slice(0, 140)}`})`.catch(()=>{});
    }
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// DELETE /api/announcements/:id/comments/:commentId
app.delete('/api/announcements/:id/comments/:commentId', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const c = (await sql`SELECT posted_by_id FROM announcement_comments WHERE id=${req.params.commentId}`)[0] as any;
    if (!c) return res.status(404).json({ error: 'Comment not found' });
    const isAdminOrHR = u.role === 'admin' || u.role === 'hr_manager';
    const isOwn = c.posted_by_id === uid;
    if (!isAdminOrHR && !isOwn) return res.status(403).json({ error: 'You can only delete your own comments.' });
    await sql`DELETE FROM announcement_comments WHERE id=${req.params.commentId}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ── Template Hub ─────────────────────────────────────────────────────────
// HR-maintained library of email + letter templates. Read is open to any
// signed-in user so anyone composing an official email can grab the
// right boilerplate; write is admin / HR only.

app.get('/api/templates', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    // Template Hub is HR/admin-only for now — coordinators and employees
    // can be opened up later by relaxing this gate (no client changes needed).
    if (u.role !== 'admin' && u.role !== 'hr_manager') {
      return res.status(403).json({ error: 'Admin / HR only' });
    }
    const cat = (req.query.category as string) || null;
    const fmt = (req.query.format as string) || null;
    const rows = await sql`
      SELECT * FROM templates
      WHERE (${cat}::text IS NULL OR category=${cat})
        AND (${fmt}::text IS NULL OR format=${fmt})
      ORDER BY category NULLS LAST, title`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

app.post('/api/templates', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (u.role !== 'admin' && u.role !== 'hr_manager') {
      return res.status(403).json({ error: 'Admin / HR only' });
    }
    const { title, category, format, subject, body, description, tags } = req.body ?? {};
    if (!title?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Title and body are required' });
    }
    const fmt = (format === 'letter') ? 'letter' : 'email';
    const id = `tpl_${Date.now()}`;
    const row = (await sql`
      INSERT INTO templates (id, title, category, format, subject, body, description, tags,
        created_by_id, created_by_name, updated_by_id, updated_by_name)
      VALUES (${id}, ${title.trim()}, ${category?.trim() || null}, ${fmt},
              ${subject?.trim() || null}, ${body}, ${description?.trim() || null},
              ${Array.isArray(tags) && tags.length ? tags : null}::text[],
              ${u.id}, ${u.name}, ${u.id}, ${u.name})
      RETURNING *`)[0];
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

app.put('/api/templates/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (u.role !== 'admin' && u.role !== 'hr_manager') {
      return res.status(403).json({ error: 'Admin / HR only' });
    }
    const { title, category, format, subject, body, description, tags, active } = req.body ?? {};
    const row = (await sql`
      UPDATE templates SET
        title       = COALESCE(${title?.trim() || null}, title),
        category    = ${category === undefined ? null : (category?.trim() || null)},
        format      = COALESCE(${format === 'email' || format === 'letter' ? format : null}, format),
        subject     = ${subject === undefined ? null : (subject?.trim() || null)},
        body        = COALESCE(${body || null}, body),
        description = ${description === undefined ? null : (description?.trim() || null)},
        tags        = ${tags === undefined ? null : (Array.isArray(tags) && tags.length ? tags : null)}::text[],
        active      = COALESCE(${active === undefined ? null : !!active}, active),
        updated_by_id   = ${u.id},
        updated_by_name = ${u.name},
        updated_at  = NOW()
      WHERE id=${req.params.id}
      RETURNING *`)[0];
    if (!row) return res.status(404).json({ error: 'Template not found' });
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

app.delete('/api/templates/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (u.role !== 'admin' && u.role !== 'hr_manager') {
      return res.status(403).json({ error: 'Admin / HR only' });
    }
    // Soft-delete via active=false so existing references keep resolving.
    await sql`UPDATE templates SET active=FALSE, updated_at=NOW() WHERE id=${req.params.id}`;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/upcoming-events — single endpoint that returns the next ~30 days
// of holidays + employee birthdays + work anniversaries combined into one
// chronological list. Saves the client three round-trips and lets the date
// math happen on the server (postgres handles month/day matching cleanly).
// GET /api/version — returns the identifier the deployed function was
// built from. The frontend polls this every minute and compares against
// __APP_VERSION__ baked into the JS bundle at build time. Mismatch →
// new deploy went live → show the "Refresh" banner.
//
// Priority matches vite.config.ts so both sides resolve to the same
// value on the same deploy:
//   1. VERCEL_GIT_COMMIT_SHA  (requires GitHub system-env opt-in)
//   2. VERCEL_DEPLOYMENT_ID   (always set on Vercel)
//   3. null                    (local dev runs of the API)
//
// Returning a real value (deployment ID) instead of the magic 'dev'
// string means the comparison still works even if the GitHub-SHA env
// var isn't exposed — the deployment ID changes on every deploy and is
// always available at runtime. Public (no auth) so the banner works
// pre-login too. CDN cache disabled so the value is always live.
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const version =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    null;
  res.json({ version });
});

app.get('/api/upcoming-events', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const horizonDays = Math.min(60, Math.max(7, Number(req.query.days) || 30));
    // Lookback window for "just happened" events so today's birthday
    // doesn't vanish from the widget the moment the day rolls over.
    // The user kept missing Sahil's birthday post-deploy because at
    // 00:00 UTC the next-occurrence math jumped to 2027. Three days
    // is enough catch-up without cluttering the widget with stale rows.
    const lookbackDays = 3;
    // Holidays — straight date filter, now including the small lookback.
    const holidayRows = await sql`
      SELECT id, name, date::text AS event_date, 'holiday' AS kind
      FROM holidays
      WHERE date::date BETWEEN CURRENT_DATE - ${lookbackDays}::int AND CURRENT_DATE + ${horizonDays}::int
      ORDER BY date`;
    // Birthdays + anniversaries: the next occurrence is "this-year date"
    // if that date is still within the lookback OR ahead, otherwise next
    // year. The lookback addition is the key fix — previously the CASE
    // used `>= CURRENT_DATE`, which immediately flipped to next year on
    // the day after the birthday.
    const birthdayRows = await sql`
      SELECT e.id, e.name, e.designation, e.department, e.avatar,
        e.date_of_birth::text AS source_date,
        TO_CHAR(
          CASE WHEN TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE) || TO_CHAR(e.date_of_birth, '-MM-DD'), 'YYYY-MM-DD') >= CURRENT_DATE - ${lookbackDays}::int
               THEN TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE) || TO_CHAR(e.date_of_birth, '-MM-DD'), 'YYYY-MM-DD')
               ELSE TO_DATE((EXTRACT(YEAR FROM CURRENT_DATE) + 1) || TO_CHAR(e.date_of_birth, '-MM-DD'), 'YYYY-MM-DD')
          END, 'YYYY-MM-DD'
        ) AS event_date
      FROM employees e
      WHERE e.status = 'active' AND e.date_of_birth IS NOT NULL
      ORDER BY event_date`;
    const anniversaryRows = await sql`
      SELECT e.id, e.name, e.designation, e.department, e.avatar,
        e.join_date::text AS source_date,
        TO_CHAR(
          CASE WHEN TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE) || TO_CHAR(e.join_date, '-MM-DD'), 'YYYY-MM-DD') >= CURRENT_DATE - ${lookbackDays}::int
               THEN TO_DATE(EXTRACT(YEAR FROM CURRENT_DATE) || TO_CHAR(e.join_date, '-MM-DD'), 'YYYY-MM-DD')
               ELSE TO_DATE((EXTRACT(YEAR FROM CURRENT_DATE) + 1) || TO_CHAR(e.join_date, '-MM-DD'), 'YYYY-MM-DD')
          END, 'YYYY-MM-DD'
        ) AS event_date,
        (EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM e.join_date))::int AS years_completed
      FROM employees e
      WHERE e.status = 'active' AND e.join_date IS NOT NULL
        AND EXTRACT(YEAR FROM CURRENT_DATE) > EXTRACT(YEAR FROM e.join_date)
      ORDER BY event_date`;
    const horizonStr = new Date(Date.now() + horizonDays * 86400_000).toISOString().slice(0, 10);
    const lookbackStr = new Date(Date.now() - lookbackDays * 86400_000).toISOString().slice(0, 10);

    const events = [
      ...(holidayRows as any[]).map(r => ({
        kind: 'holiday' as const,
        event_date: r.event_date,
        label: r.name,
      })),
      ...(birthdayRows as any[])
        .filter(r => r.event_date >= lookbackStr && r.event_date <= horizonStr)
        .map(r => ({
          kind: 'birthday' as const,
          event_date: r.event_date,
          label: `${r.name}'s birthday`,
          employee: { id: r.id, name: r.name, designation: r.designation, department: r.department, avatar: r.avatar },
        })),
      ...(anniversaryRows as any[])
        .filter(r => r.event_date >= lookbackStr && r.event_date <= horizonStr)
        .map(r => ({
          kind: 'anniversary' as const,
          event_date: r.event_date,
          label: `${r.name} · ${r.years_completed} year${r.years_completed === 1 ? '' : 's'}`,
          years: r.years_completed,
          employee: { id: r.id, name: r.name, designation: r.designation, department: r.department, avatar: r.avatar },
        })),
    ].sort((a, b) => a.event_date.localeCompare(b.event_date));

    res.json(events);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────
// Granular per-user permissions
// Roles stay as presets; this is the fine-grained layer on top.
//   Effective(user, module, verb) =
//     override_row(user_id, module_id).can_<verb>   IF exists
//     ELSE role_default(user.role, module_id).can_<verb>
//     ELSE false
// userCan() implements the same logic so backend endpoints can gate on it
// without each endpoint having to JOIN three tables.
// ─────────────────────────────────────────────────────────────────────────

type PermVerb = 'read' | 'create' | 'modify' | 'delete' | 'approve';

async function userCan(userId: string, moduleId: string, verb: PermVerb): Promise<boolean> {
  if (!userId) return false;
  const u = (await sql`SELECT role FROM app_users WHERE id=${userId}`)[0] as any;
  if (!u) return false;
  // Admin always allowed — defensive backstop so a misconfigured override
  // can't lock the org out of itself.
  if (u.role === 'admin') return true;
  const col = `can_${verb}`;
  const override = (await sql`
    SELECT can_read, can_create, can_modify, can_delete, can_approve
    FROM user_permission_overrides
    WHERE user_id=${userId} AND module_id=${moduleId}`)[0] as any;
  if (override) return !!override[col];
  const def = (await sql`
    SELECT can_read, can_create, can_modify, can_delete, can_approve
    FROM role_default_permissions
    WHERE role=${u.role} AND module_id=${moduleId}`)[0] as any;
  if (def) return !!def[col];
  return false;
}

// GET /api/permissions/modules — list the catalog. Admin-only since this
// is the basis for the permissions admin UI; mortals don't need to see it.
app.get('/api/permissions/modules', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT role FROM app_users WHERE id=${uid}`)[0] as any;
    if (u?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const rows = await sql`SELECT * FROM permission_modules ORDER BY display_order, label`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/permissions/user/:id — return the effective grid for one user,
// plus a flag per row indicating whether it's a role default or an
// override (so the UI can show which cells were customized).
app.get('/api/permissions/user/:id', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const me = (await sql`SELECT role FROM app_users WHERE id=${uid}`)[0] as any;
    // Allow admin to read anyone; anyone else can read only their own grid
    // (so an HR can see what they have access to, just can't edit it).
    if (me?.role !== 'admin' && uid !== req.params.id) {
      return res.status(403).json({ error: 'Not permitted' });
    }
    const target = (await sql`SELECT id, name, email, role FROM app_users WHERE id=${req.params.id}`)[0] as any;
    if (!target) return res.status(404).json({ error: 'User not found' });
    const modules = await sql`SELECT * FROM permission_modules ORDER BY display_order, label`;
    const defaults = await sql`SELECT * FROM role_default_permissions WHERE role=${target.role}`;
    const overrides = await sql`SELECT * FROM user_permission_overrides WHERE user_id=${req.params.id}`;
    const defByMod: Record<string, any> = {};
    (defaults as any[]).forEach(d => { defByMod[d.module_id] = d; });
    const ovrByMod: Record<string, any> = {};
    (overrides as any[]).forEach(o => { ovrByMod[o.module_id] = o; });
    const grid = (modules as any[]).map(m => {
      const o = ovrByMod[m.id];
      const d = defByMod[m.id] ?? {};
      const pick = (k: string) => (o ? o[k] : d[k]) ?? false;
      return {
        module_id: m.id, label: m.label, group_label: m.group_label, has_approve: m.has_approve,
        can_read:    !!pick('can_read'),
        can_create:  !!pick('can_create'),
        can_modify:  !!pick('can_modify'),
        can_delete:  !!pick('can_delete'),
        can_approve: !!pick('can_approve'),
        is_override: !!o,
        // Expose the role defaults too so the UI can show "back to defaults"
        // and highlight which cells deviated.
        default_can_read:    !!d.can_read,
        default_can_create:  !!d.can_create,
        default_can_modify:  !!d.can_modify,
        default_can_delete:  !!d.can_delete,
        default_can_approve: !!d.can_approve,
      };
    });
    res.json({ user: target, grid });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PUT /api/permissions/user/:id — admin only. Body shape:
//   { overrides: [ { module_id, can_read, can_create, can_modify, can_delete, can_approve, clear? }, ... ] }
// `clear: true` deletes the override row so the user falls back to the
// role default for that module. Anything else inserts/updates the override.
app.put('/api/permissions/user/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const me = (await sql`SELECT role, name FROM app_users WHERE id=${uid}`)[0] as any;
    if (me?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const target = (await sql`SELECT id FROM app_users WHERE id=${req.params.id}`)[0] as any;
    if (!target) return res.status(404).json({ error: 'User not found' });
    const overrides = (req.body?.overrides ?? []) as Array<any>;
    if (!Array.isArray(overrides)) return res.status(400).json({ error: 'overrides must be an array' });

    for (const o of overrides) {
      const mid = String(o.module_id);
      if (o.clear) {
        await sql`DELETE FROM user_permission_overrides WHERE user_id=${req.params.id} AND module_id=${mid}`;
        continue;
      }
      await sql`
        INSERT INTO user_permission_overrides
          (user_id, module_id, can_read, can_create, can_modify, can_delete, can_approve, updated_by)
        VALUES (${req.params.id}, ${mid}, ${!!o.can_read}, ${!!o.can_create}, ${!!o.can_modify}, ${!!o.can_delete}, ${!!o.can_approve}, ${me.name ?? uid})
        ON CONFLICT (user_id, module_id) DO UPDATE SET
          can_read = EXCLUDED.can_read,
          can_create = EXCLUDED.can_create,
          can_modify = EXCLUDED.can_modify,
          can_delete = EXCLUDED.can_delete,
          can_approve = EXCLUDED.can_approve,
          updated_at = NOW(),
          updated_by = EXCLUDED.updated_by`;
    }
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/permissions/me — short-circuit for the frontend: returns the
// CURRENT user's effective grid as a flat { moduleId: { read, ... } } map
// the client can cache and gate UI on. Doesn't require admin.
app.get('/api/permissions/me', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    // Admin shortcut — return a sentinel the client can detect to skip
    // the per-module check entirely.
    if (u.role === 'admin') return res.json({ admin: true });
    const modules = await sql`SELECT id FROM permission_modules`;
    const defaults = await sql`SELECT module_id, can_read, can_create, can_modify, can_delete, can_approve
                               FROM role_default_permissions WHERE role=${u.role}`;
    const overrides = await sql`SELECT module_id, can_read, can_create, can_modify, can_delete, can_approve
                                FROM user_permission_overrides WHERE user_id=${uid}`;
    const map: Record<string, any> = {};
    (defaults as any[]).forEach(d => {
      map[d.module_id] = {
        read: !!d.can_read, create: !!d.can_create, modify: !!d.can_modify,
        delete: !!d.can_delete, approve: !!d.can_approve,
      };
    });
    (overrides as any[]).forEach(o => {
      map[o.module_id] = {
        read: !!o.can_read, create: !!o.can_create, modify: !!o.can_modify,
        delete: !!o.can_delete, approve: !!o.can_approve,
      };
    });
    // Make sure every module has an entry even if neither default nor
    // override was set (e.g. brand-new module added to the catalog and
    // role defaults haven't been seeded for it yet).
    (modules as any[]).forEach(m => {
      if (!map[m.id]) map[m.id] = { read: false, create: false, modify: false, delete: false, approve: false };
    });
    res.json({ admin: false, permissions: map });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────
// Allocation change requests
// Manager / project reviewer proposes new W1-W5 + monthly_hours for an
// employee's project assignment. Coordinator (or admin) approves to write
// the change back to project_assignments. Approval is the only path that
// mutates the source table — the request flow itself is purely additive.
// ─────────────────────────────────────────────────────────────────────────

// Permission: who can REQUEST a change against `targetEmpId` on this project?
// - admin / HR / project_coordinator: always
// - direct reporting manager of the employee (walks the chain)
// - project_reporting_id on the project (the "reviewer")
// - project_lead_id on the project (the lead)
async function canRequestAllocation(u: any, actorEmpId: string | null, targetEmpId: string, projectId: string): Promise<boolean> {
  if (!u) return false;
  if (u.role === 'admin' || u.role === 'hr_manager' || u.role === 'project_coordinator') return true;
  if (!actorEmpId) return false;
  // Project reviewer or lead? (column name was wrong here — projects has
  // project_reporting_id, not reporting_person_id, so the SELECT was
  // throwing 'column does not exist' and bubbling up as "Failed to send"
  // on the allocation-change modal even though the actor was legitimate.)
  const p = (await sql`SELECT project_reporting_id, project_lead_id FROM projects WHERE id=${projectId}`)[0] as any;
  if (p && (p.project_reporting_id === actorEmpId || p.project_lead_id === actorEmpId)) return true;
  // Manager walk
  let cur = targetEmpId;
  for (let i = 0; i < 10; i++) {
    const row = (await sql`SELECT reporting_manager_id FROM employees WHERE id=${cur}`)[0] as any;
    if (!row?.reporting_manager_id) return false;
    if (row.reporting_manager_id === actorEmpId) return true;
    cur = row.reporting_manager_id;
  }
  return false;
}

// POST /api/allocation-requests — propose a change.
app.post('/api/allocation-requests', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });

    const { assignment_id, proposed_w1, proposed_w2, proposed_w3, proposed_w4, proposed_w5, proposed_monthly, reason } = req.body ?? {};
    if (!assignment_id) return res.status(400).json({ error: 'assignment_id is required' });
    if (!reason?.trim()) return res.status(400).json({ error: 'Reason is required' });

    const assn = (await sql`
      SELECT a.*, p.name AS project_name
      FROM project_assignments a
      JOIN projects p ON p.id = a.project_id
      WHERE a.id=${assignment_id}`)[0] as any;
    if (!assn) return res.status(404).json({ error: 'Assignment not found' });

    const actorEmpId = await resolveUserToEmployee(u);
    const allowed = await canRequestAllocation(u, actorEmpId, assn.employee_id, assn.project_id);
    if (!allowed) return res.status(403).json({ error: 'You can only propose changes for your team or projects you review.' });

    // Block duplicate pending requests against the same assignment so the
    // coordinator's queue stays clean. If you want to revise, cancel first.
    const dupe = (await sql`SELECT id FROM allocation_change_requests WHERE assignment_id=${assignment_id} AND status='pending' LIMIT 1`)[0] as any;
    if (dupe) return res.status(409).json({ error: 'There is already a pending request for this assignment. Cancel it first.' });

    const id = `ar_${Date.now()}`;
    const num = (v: any) => v == null || v === '' ? null : Number(v);
    const row = (await sql`
      INSERT INTO allocation_change_requests
        (id, assignment_id, project_id, project_name, employee_id, employee_name, month, year,
         current_w1, current_w2, current_w3, current_w4, current_w5, current_monthly,
         proposed_w1, proposed_w2, proposed_w3, proposed_w4, proposed_w5, proposed_monthly,
         reason, requested_by_id, requested_by_name, requested_by_role)
      VALUES
        (${id}, ${assignment_id}, ${assn.project_id}, ${assn.project_name}, ${assn.employee_id}, ${assn.employee_name},
         ${assn.month}, ${assn.year},
         ${assn.w1_hours}, ${assn.w2_hours}, ${assn.w3_hours}, ${assn.w4_hours}, ${assn.w5_hours}, ${assn.monthly_hours},
         ${num(proposed_w1)}, ${num(proposed_w2)}, ${num(proposed_w3)}, ${num(proposed_w4)}, ${num(proposed_w5)}, ${num(proposed_monthly)},
         ${reason.trim()}, ${u.id}, ${u.name}, ${u.role})
      RETURNING *`)[0];

    // Ping coordinators (the approvers) AND admins+HR so the queue doesn't
    // sit unattended if a coordinator is OOO.
    const blurb = `${u.name} proposed a change for ${assn.employee_name} on ${assn.project_name} (${assn.month}/${assn.year}). Reason: ${reason.trim().slice(0, 140)}`;
    notifyCoordinators('allocation_request', 'Allocation change requested', blurb).catch(()=>{});
    notifyAdminsAndHR('allocation_request', 'Allocation change requested', blurb).catch(()=>{});

    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// GET /api/allocation-requests — list. Coordinators/admin/HR see everything;
// requesters see their own. Filters: status, project_id.
app.get('/api/allocation-requests', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });

    const isReviewer = u.role === 'admin' || u.role === 'hr_manager' || u.role === 'project_coordinator';
    const status = (req.query.status as string) || null;
    const projectId = (req.query.project_id as string) || null;

    const rows = await sql`
      SELECT * FROM allocation_change_requests
      WHERE (${status}::text IS NULL OR status = ${status})
        AND (${projectId}::text IS NULL OR project_id = ${projectId})
        AND (${isReviewer ? true : false} OR requested_by_id = ${uid})
      ORDER BY
        CASE status WHEN 'pending' THEN 0 ELSE 1 END,
        created_at DESC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PATCH /api/allocation-requests/:id/approve — coordinator / admin only.
// On approve: copy proposed_* → project_assignments, then mark request
// approved. Reason: the source-of-truth is project_assignments, not the
// request table — approving is what makes the change real.
app.patch('/api/allocation-requests/:id/approve', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (u.role !== 'admin' && u.role !== 'project_coordinator') {
      return res.status(403).json({ error: 'Only coordinators or admin can approve allocation changes.' });
    }
    const { review_note } = req.body ?? {};

    const r = (await sql`SELECT * FROM allocation_change_requests WHERE id=${req.params.id}`)[0] as any;
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'pending') return res.status(409).json({ error: `Already ${r.status}` });

    // Apply proposed values, falling back to current for any null slot
    // (lets the requester touch just the weeks they care about).
    const apply = (proposed: any, current: any) => proposed == null ? current : proposed;
    await sql`
      UPDATE project_assignments SET
        w1_hours = ${apply(r.proposed_w1, r.current_w1)},
        w2_hours = ${apply(r.proposed_w2, r.current_w2)},
        w3_hours = ${apply(r.proposed_w3, r.current_w3)},
        w4_hours = ${apply(r.proposed_w4, r.current_w4)},
        w5_hours = ${apply(r.proposed_w5, r.current_w5)},
        monthly_hours = ${apply(r.proposed_monthly, r.current_monthly)},
        updated_at = NOW()
      WHERE id = ${r.assignment_id}`;

    const updated = (await sql`
      UPDATE allocation_change_requests SET
        status='approved',
        reviewed_by_id=${u.id}, reviewed_by_name=${u.name},
        reviewed_at=NOW(), review_note=${review_note ?? null},
        updated_at=NOW()
      WHERE id=${req.params.id}
      RETURNING *`)[0];

    // Notify requester + affected employee (they should know their plan moved).
    if (r.requested_by_id && r.requested_by_id !== u.id) {
      notifyEmployeeUser(r.requested_by_id, 'allocation_approved',
        'Allocation change approved',
        `${u.name} approved your change for ${r.employee_name} on ${r.project_name}.`).catch(()=>{});
    }
    if (r.employee_id) {
      notifyEmployeeUser(r.employee_id, 'allocation_changed',
        'Your allocation was updated',
        `${u.name} updated your hours on ${r.project_name} for ${r.month}/${r.year}.`).catch(()=>{});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PATCH /api/allocation-requests/:id/reject — coordinator / admin only.
app.patch('/api/allocation-requests/:id/reject', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (u.role !== 'admin' && u.role !== 'project_coordinator') {
      return res.status(403).json({ error: 'Only coordinators or admin can reject allocation changes.' });
    }
    const { review_note } = req.body ?? {};
    if (!review_note?.trim()) return res.status(400).json({ error: 'A note is required when rejecting' });

    const r = (await sql`SELECT * FROM allocation_change_requests WHERE id=${req.params.id}`)[0] as any;
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'pending') return res.status(409).json({ error: `Already ${r.status}` });

    const updated = (await sql`
      UPDATE allocation_change_requests SET
        status='rejected',
        reviewed_by_id=${u.id}, reviewed_by_name=${u.name},
        reviewed_at=NOW(), review_note=${review_note.trim()},
        updated_at=NOW()
      WHERE id=${req.params.id}
      RETURNING *`)[0];

    if (r.requested_by_id && r.requested_by_id !== u.id) {
      notifyEmployeeUser(r.requested_by_id, 'allocation_rejected',
        'Allocation change rejected',
        `${u.name} rejected your change for ${r.employee_name} on ${r.project_name}: ${review_note.trim().slice(0, 140)}`).catch(()=>{});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PATCH /api/allocation-requests/:id/cancel — the original requester can
// cancel their own pending request (e.g. they want to revise).
app.patch('/api/allocation-requests/:id/cancel', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const r = (await sql`SELECT * FROM allocation_change_requests WHERE id=${req.params.id}`)[0] as any;
    if (!r) return res.status(404).json({ error: 'Request not found' });
    if (r.status !== 'pending') return res.status(409).json({ error: `Already ${r.status}` });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (r.requested_by_id !== uid && u.role !== 'admin') {
      return res.status(403).json({ error: 'Only the requester or admin can cancel.' });
    }
    const updated = (await sql`
      UPDATE allocation_change_requests SET status='cancelled', updated_at=NOW()
      WHERE id=${req.params.id} RETURNING *`)[0];
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ─────────────────────────────────────────────────────────────────────────
// Attendance notes — context for short days / partial attendance.
// Permission: the employee themselves, anyone up their reporting chain,
// HR, admin. The chain walk caps at 10 levels (same as the todo/allocation
// helpers).
// ─────────────────────────────────────────────────────────────────────────

async function canTouchAttendanceNote(u: any, actorEmpId: string | null, targetEmpId: string): Promise<boolean> {
  if (!u) return false;
  if (u.role === 'admin' || u.role === 'hr_manager') return true;
  if (actorEmpId && actorEmpId === targetEmpId) return true;
  if (!actorEmpId) return false;
  let cur = targetEmpId;
  for (let i = 0; i < 10; i++) {
    const row = (await sql`SELECT reporting_manager_id FROM employees WHERE id=${cur}`)[0] as any;
    if (!row?.reporting_manager_id) return false;
    if (row.reporting_manager_id === actorEmpId) return true;
    cur = row.reporting_manager_id;
  }
  return false;
}

// GET /api/attendance-notes?employee_id=&month=&year= — list notes for
// the month so the UI can colocate them with the attendance rows. Read
// access is the same as write access (covered by canTouchAttendanceNote).
app.get('/api/attendance-notes', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role, employee_id_ref, email, name FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const employee_id = (req.query.employee_id as string) || '';
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!employee_id || !month || !year) return res.status(400).json({ error: 'employee_id, month, year are required' });

    const actorEmpId = await resolveUserToEmployee(u);
    const ok = await canTouchAttendanceNote(u, actorEmpId, employee_id);
    if (!ok) return res.status(403).json({ error: 'Not permitted to view notes for this employee.' });

    const rows = await sql`
      SELECT employee_id, date::text AS date, note, author_id, author_name, author_role,
             status, approved_by_id, approved_by_name, approved_at, rejection_reason,
             created_at, updated_at
      FROM attendance_notes
      WHERE employee_id=${employee_id}
        AND EXTRACT(MONTH FROM date) = ${month}
        AND EXTRACT(YEAR  FROM date) = ${year}
      ORDER BY date`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PUT /api/attendance-notes — upsert one note. Empty body = delete.
// Status rules:
//   - admin / hr_manager / project_coordinator / manager-in-chain → 'approved'
//     immediately on save (they're trusted to vouch for their own annotations).
//   - employee (self-reporting) → 'pending' — needs a reviewer to approve
//     before HR / reporting flows treat it as a verified explanation.
app.put('/api/attendance-notes', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const { employee_id, date, note } = req.body ?? {};
    if (!employee_id || !date) return res.status(400).json({ error: 'employee_id and date are required' });

    const actorEmpId = await resolveUserToEmployee(u);
    const ok = await canTouchAttendanceNote(u, actorEmpId, employee_id);
    if (!ok) return res.status(403).json({ error: 'Not permitted to add a note for this employee.' });

    if (!note || !note.trim()) {
      await sql`DELETE FROM attendance_notes WHERE employee_id=${employee_id} AND date=${date}`;
      return res.json({ ok: true, deleted: true });
    }

    // Self-author? Only an employee writing their OWN note needs approval.
    // Anyone with management authority (admin/HR, or actor != target) is
    // recording a verified observation.
    const isSelfEmployeeAuthor = u.role === 'employee' && actorEmpId === employee_id;
    const newStatus = isSelfEmployeeAuthor ? 'pending' : 'approved';
    const approvedById   = isSelfEmployeeAuthor ? null : u.id;
    const approvedByName = isSelfEmployeeAuthor ? null : u.name;
    const approvedAt     = isSelfEmployeeAuthor ? null : new Date().toISOString();

    const row = (await sql`
      INSERT INTO attendance_notes (employee_id, date, note, author_id, author_name, author_role,
                                    status, approved_by_id, approved_by_name, approved_at, rejection_reason)
      VALUES (${employee_id}, ${date}, ${note.trim()}, ${u.id}, ${u.name}, ${u.role},
              ${newStatus}, ${approvedById}, ${approvedByName}, ${approvedAt}, ${null})
      ON CONFLICT (employee_id, date) DO UPDATE SET
        note              = EXCLUDED.note,
        author_id         = EXCLUDED.author_id,
        author_name       = EXCLUDED.author_name,
        author_role       = EXCLUDED.author_role,
        status            = EXCLUDED.status,
        approved_by_id    = EXCLUDED.approved_by_id,
        approved_by_name  = EXCLUDED.approved_by_name,
        approved_at       = EXCLUDED.approved_at,
        rejection_reason  = NULL,
        updated_at        = NOW()
      RETURNING employee_id, date::text AS date, note, author_id, author_name, author_role,
                status, approved_by_id, approved_by_name, approved_at, rejection_reason,
                created_at, updated_at`)[0];
    // Ping the reporting manager when an employee submits a pending note so
    // they know there's something to approve.
    if (isSelfEmployeeAuthor) {
      try {
        notifyManagerOfEmployee(employee_id, 'attendance_note_pending', 'Attendance note awaiting approval',
          `${u.name} added a note on ${date} that needs your review: ${note.trim().slice(0, 140)}`).catch(()=>{});
      } catch {}
    }
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PATCH /api/attendance-notes/approve  |  /api/attendance-notes/reject
// Body: { employee_id, date, rejection_reason? }
// Permission: any reviewer the employee can route to (canTouchAttendanceNote).
// Self-employee can NOT approve their own note (would defeat the workflow).
// Two explicit routes because Express 5 / path-to-regexp v8 no longer
// supports the `:param(regex)` syntax — registering it throws at module
// load and brings down the whole serverless function.
async function handleAttendanceNoteReview(action: 'approve' | 'reject', req: any, res: any) {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const { employee_id, date, rejection_reason } = req.body ?? {};
    if (!employee_id || !date) return res.status(400).json({ error: 'employee_id and date are required' });
    if (action === 'reject' && !rejection_reason?.trim()) {
      return res.status(400).json({ error: 'A reason is required when rejecting a note.' });
    }
    const actorEmpId = await resolveUserToEmployee(u);
    // Block self-approval — an employee approving their own note would
    // sidestep the entire workflow.
    if (actorEmpId === employee_id && u.role === 'employee') {
      return res.status(403).json({ error: "You can't approve your own attendance note." });
    }
    const ok = await canTouchAttendanceNote(u, actorEmpId, employee_id);
    if (!ok) return res.status(403).json({ error: 'Not permitted to review notes for this employee.' });
    const cur = (await sql`SELECT note, author_name FROM attendance_notes WHERE employee_id=${employee_id} AND date=${date}`)[0] as any;
    if (!cur) return res.status(404).json({ error: 'Note not found' });

    const row = (await sql`
      UPDATE attendance_notes SET
        status            = ${action === 'approve' ? 'approved' : 'rejected'},
        approved_by_id    = ${u.id},
        approved_by_name  = ${u.name},
        approved_at       = NOW(),
        rejection_reason  = ${action === 'reject' ? rejection_reason.trim() : null},
        updated_at        = NOW()
      WHERE employee_id=${employee_id} AND date=${date}
      RETURNING employee_id, date::text AS date, note, author_id, author_name, author_role,
                status, approved_by_id, approved_by_name, approved_at, rejection_reason,
                created_at, updated_at`)[0];
    // Tell the employee what happened on their note.
    notifyEmployeeUser(employee_id,
      action === 'approve' ? 'attendance_note_approved' : 'attendance_note_rejected',
      action === 'approve' ? 'Attendance note approved' : 'Attendance note needs revision',
      action === 'approve'
        ? `${u.name} approved your note on ${date}.`
        : `${u.name} rejected your note on ${date}: ${rejection_reason.trim().slice(0, 140)}`
    ).catch(()=>{});
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
}
app.patch('/api/attendance-notes/approve', (req, res) => handleAttendanceNoteReview('approve', req, res));
app.patch('/api/attendance-notes/reject',  (req, res) => handleAttendanceNoteReview('reject',  req, res));

// ── Internal hour logs (self-reported, no approval) ────────────────────
// Read-permission helper for internal hour logs. Wider than the direct
// reporting manager check because the "Mine" tab in ProjectHours
// surfaces teammates via TWO paths — descendants in the reporting tree
// AND people allocated to a project where you're the reviewer or lead.
// Internal-hour visibility should mirror both, otherwise a project
// reviewer who can see a teammate's project hours hits an empty
// Internal Activities section for no obvious reason.
async function canViewInternalHoursOf(u: any, actorEmpId: string | null, targetEmpId: string, actorEmpCode: string | null): Promise<boolean> {
  if (!u) return false;
  if (u.role === 'admin' || u.role === 'hr_manager') return true;
  if (actorEmpId && actorEmpId === targetEmpId) return true;
  if (!actorEmpId) return false;
  // 1. Reporting chain walk (cap 10 levels). reporting_manager_id can
  //    hold either the internal id or the human code in legacy data,
  //    so we accept either.
  let cur = targetEmpId;
  for (let i = 0; i < 10; i++) {
    const row = (await sql`SELECT reporting_manager_id FROM employees WHERE id=${cur}`)[0] as any;
    if (!row?.reporting_manager_id) break;
    if (row.reporting_manager_id === actorEmpId || row.reporting_manager_id === actorEmpCode) return true;
    cur = row.reporting_manager_id;
  }
  // 2. Project reviewer / lead path: any project the target is allocated
  //    to where the actor sits as project_reporting_id or project_lead_id.
  //    Single LIMIT 1 query; small assignment-per-employee set.
  const proj = (await sql`
    SELECT 1
    FROM project_assignments pa
    JOIN projects p ON p.id = pa.project_id
    WHERE pa.employee_id = ${targetEmpId}
      AND (p.project_reporting_id = ${actorEmpId} OR p.project_lead_id = ${actorEmpId})
    LIMIT 1`)[0] as any;
  return !!proj;
}

app.get('/api/internal-hour-logs', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const { employee_id, from, to } = req.query as any;
    // Resolve self to the internal employees.id (stored format on
    // internal_hour_logs.employee_id after the backfill). Tolerate
    // both forms on app_users.employee_id_ref so legacy rows that
    // store the internal id directly still resolve.
    const self = (await sql`
      SELECT id, employee_id FROM employees
      WHERE employee_id = ${u.employee_id_ref}
         OR id = ${u.employee_id_ref}
      LIMIT 1`)[0] as any;
    const selfId = self?.id ?? null;
    // Target = explicit OR self. Explicit ids from the UI are internal
    // employees.id (that's what emp.id is on the client).
    const targetEmpId = employee_id || selfId;
    if (!targetEmpId) return res.json([]);
    const allowed = await canViewInternalHoursOf(u, selfId, targetEmpId, self?.employee_id ?? null);
    if (!allowed) return res.status(403).json({ error: 'Not permitted' });
    const fromD = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const toD = to || new Date().toISOString().slice(0, 10);
    const rows = await sql`
      SELECT l.*, a.name AS activity_name
      FROM internal_hour_logs l
      LEFT JOIN internal_activities a ON a.id = l.activity_id
      WHERE l.employee_id=${targetEmpId}
        AND l.log_date BETWEEN ${fromD}::date AND ${toD}::date
      ORDER BY l.log_date DESC, a.sort_order`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});
app.post('/api/internal-hour-logs', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u?.employee_id_ref) return res.status(400).json({ error: 'No employee profile linked to this user' });
    // Resolve the user's employee_id_ref (human code) to the internal
    // employees.id so the row matches the format every reader queries
    // by. Tolerate either form on the input column in case some legacy
    // app_users row stores the internal id instead of the human code.
    const empRow = (await sql`
      SELECT id FROM employees
      WHERE employee_id = ${u.employee_id_ref}
         OR id = ${u.employee_id_ref}
      LIMIT 1`)[0] as any;
    if (!empRow?.id) return res.status(400).json({ error: 'Could not resolve user to an employee record' });
    const empDbId = empRow.id;
    const { activity_id, log_date, hours, notes } = req.body ?? {};
    if (!activity_id || !log_date) return res.status(400).json({ error: 'activity_id and log_date are required' });
    const h = Number(hours);
    if (!h || h <= 0 || h > 24) return res.status(400).json({ error: 'hours must be between 0 and 24' });
    if (!(notes ?? '').trim()) return res.status(400).json({ error: 'Notes are required (what did you do?)' });
    const id = `inlog_${Date.now()}`;
    // Upsert by (employee, activity, date) so re-saving the same day
    // updates instead of erroring with the unique constraint. Re-saving
    // ALWAYS resets the row back to 'pending' — an employee tweaking
    // their hours after manager approval needs a fresh review.
    const row = (await sql`
      INSERT INTO internal_hour_logs (id, employee_id, activity_id, log_date, hours, notes, status,
        reviewed_by_id, reviewed_by_name, reviewed_at, rejection_reason)
      VALUES (${id}, ${empDbId}, ${activity_id}, ${log_date}::date, ${h}, ${notes.trim()}, 'pending',
              NULL, NULL, NULL, NULL)
      ON CONFLICT (employee_id, activity_id, log_date) DO UPDATE
        SET hours=EXCLUDED.hours, notes=EXCLUDED.notes, status='pending',
            reviewed_by_id=NULL, reviewed_by_name=NULL, reviewed_at=NULL, rejection_reason=NULL,
            updated_at=NOW()
      RETURNING *`)[0];
    // Notify the reporting manager so they see a pending review in
    // their queue without the employee having to ping them separately.
    try {
      const actName = (await sql`SELECT name FROM internal_activities WHERE id=${activity_id}`)[0] as any;
      const empName = (await sql`SELECT name FROM employees WHERE id=${empDbId}`)[0] as any;
      const datePretty = new Date(log_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      notifyManagerOfEmployee(empDbId, 'internal_logged',
        `Internal hours awaiting review`,
        `${empName?.name ?? 'An employee'} logged ${h}h on ${actName?.name ?? 'an activity'} (${datePretty}). Open Approvals to review.`
      ).catch(()=>{});
    } catch {/* notification is best-effort; the log itself is what matters */}
    res.status(201).json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// PATCH /api/internal-hour-logs/:id/approve|reject — reporting manager
// (or admin / HR) actions a pending internal-hour-log entry. Reject
// requires a reason; approve doesn't. Body: { rejection_reason? }.
// Self-approval is blocked — would defeat the workflow.
async function handleInternalLogReview(action: 'approve' | 'reject', req: any, res: any) {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const row = (await sql`SELECT * FROM internal_hour_logs WHERE id=${req.params.id}`)[0] as any;
    if (!row) return res.status(404).json({ error: 'Log not found' });
    // Permission: same set that can SEE the log can also action it —
    // canViewInternalHoursOf already covers admin / HR / chain manager
    // / project reviewer/lead. Self can NOT approve their own (the
    // canView helper allows self, so we add an explicit block here).
    const self = (await sql`
      SELECT id FROM employees
      WHERE employee_id = ${u.employee_id_ref} OR id = ${u.employee_id_ref}
      LIMIT 1`)[0] as any;
    const selfId = self?.id ?? null;
    if (selfId && selfId === row.employee_id && u.role !== 'admin' && u.role !== 'hr_manager') {
      return res.status(403).json({ error: "You can't approve your own internal hour log." });
    }
    const allowed = await canViewInternalHoursOf(u, selfId, row.employee_id, null);
    if (!allowed) return res.status(403).json({ error: 'Not permitted to review this log.' });

    if (action === 'reject') {
      const reason = req.body?.rejection_reason;
      if (!reason?.trim()) return res.status(400).json({ error: 'A reason is required when rejecting.' });
      const updated = (await sql`
        UPDATE internal_hour_logs SET
          status='rejected',
          reviewed_by_id=${u.id}, reviewed_by_name=${u.name},
          reviewed_at=NOW(),
          rejection_reason=${reason.trim()},
          updated_at=NOW()
        WHERE id=${req.params.id}
        RETURNING *`)[0];
      notifyEmployeeUser(row.employee_id, 'internal_rejected',
        'Internal hours rejected',
        `${u.name} rejected your internal-hours log on ${row.log_date}: ${reason.trim().slice(0, 140)}`
      ).catch(()=>{});
      return res.json(updated);
    }
    const updated = (await sql`
      UPDATE internal_hour_logs SET
        status='approved',
        reviewed_by_id=${u.id}, reviewed_by_name=${u.name},
        reviewed_at=NOW(),
        rejection_reason=NULL,
        updated_at=NOW()
      WHERE id=${req.params.id}
      RETURNING *`)[0];
    notifyEmployeeUser(row.employee_id, 'internal_approved',
      'Internal hours approved ✅',
      `${u.name} approved your ${row.hours}h log on ${row.log_date}.`
    ).catch(()=>{});
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
}
app.patch('/api/internal-hour-logs/:id/approve', (req, res) => handleInternalLogReview('approve', req, res));
app.patch('/api/internal-hour-logs/:id/reject',  (req, res) => handleInternalLogReview('reject',  req, res));
app.delete('/api/internal-hour-logs/:id', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    const isAdminish = u.role === 'admin' || u.role === 'hr_manager';
    const row = (await sql`SELECT employee_id FROM internal_hour_logs WHERE id=${req.params.id}`)[0] as any;
    if (!row) return res.status(404).json({ error: 'Log not found' });
    // After the schema backfill, internal_hour_logs.employee_id holds
    // the internal employees.id. Resolve the actor to the same form
    // so a self-delete comparison actually matches.
    const self = (await sql`
      SELECT id, employee_id FROM employees
      WHERE employee_id = ${u.employee_id_ref}
         OR id = ${u.employee_id_ref}
      LIMIT 1`)[0] as any;
    const isSelf = self && (row.employee_id === self.id || row.employee_id === self.employee_id);
    if (!isAdminish && !isSelf) {
      return res.status(403).json({ error: 'You can only delete your own logs' });
    }
    await sql`DELETE FROM internal_hour_logs WHERE id=${req.params.id}`;
    res.json({ ok: true });
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
// Centralized label for leave notifications so manager + HR + employee
// pings all read the same way: "half day · morning", "short leave · Q2".
function formatLeaveLabel(type: string | null | undefined, slot?: string | null): string {
  const base = (type ?? '').replace(/_/g, ' ');
  const slotMap: Record<string, string> = { morning: 'morning', evening: 'evening', q1: 'Q1', q2: 'Q2', q3: 'Q3', q4: 'Q4' };
  const suffix = slot && slotMap[slot] ? ` · ${slotMap[slot]}` : '';
  return `${base}${suffix}`;
}

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
      // Widen match to internal id + human code — see /api/employees for why.
      const mgrRow = (await sql`SELECT id, employee_id FROM employees WHERE id=${reporting_manager_id} OR employee_id=${reporting_manager_id} LIMIT 1`)[0] as any;
      const cands = mgrRow ? [mgrRow.id, mgrRow.employee_id].filter(Boolean) : [reporting_manager_id];
      rows = await sql`
        SELECT lr.* FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        WHERE e.reporting_manager_id = ANY(${cands}::text[])
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
    let { employee_id, employee_name, type, from_date, to_date, days, reason, slot } = req.body;
    // Slot validation: required for half_day / short_leave so the reviewer
    // knows WHEN in the day; ignored for full-day types.
    if (type === 'half_day') {
      if (!['morning', 'evening'].includes(slot)) {
        return res.status(400).json({ error: 'Pick which half — Morning or Evening.' });
      }
    } else if (type === 'short_leave') {
      if (!['q1', 'q2', 'q3', 'q4'].includes(slot)) {
        return res.status(400).json({ error: 'Pick which quarter of the day this short leave covers.' });
      }
    } else {
      slot = null; // not meaningful for full_day / unpaid / optional
    }
    // Same defensive resolution as WFH POST — prevents orphan rows with
    // empty employee_id that no manager can ever see.
    if (!employee_id || String(employee_id).trim() === '') {
      const uid = req.header('x-user-id');
      if (uid) {
        const u = (await sql`SELECT name, email, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
        const resolved = u ? await resolveUserToEmployee(u) : null;
        if (resolved) employee_id = resolved;
      }
      if (!employee_id && employee_name) {
        const e = (await sql`SELECT id FROM employees WHERE LOWER(TRIM(name)) = LOWER(TRIM(${employee_name})) LIMIT 1`)[0] as any;
        if (e?.id) employee_id = e.id;
      }
      if (!employee_id) return res.status(400).json({ error: 'Could not resolve your employee record. Refresh and try again.' });
    }
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
      INSERT INTO leave_requests (id, employee_id, employee_name, type, from_date, to_date, days, reason, slot, status, manager_status)
      VALUES (${id}, ${employee_id}, ${employee_name}, ${type}, ${from_date}, ${to_date}, ${days}, ${reason}, ${slot ?? null}, 'pending', 'pending')
      RETURNING *`;
    const from = new Date(from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const typeLabel = formatLeaveLabel(type, slot);
    if (emp.reporting_manager_id) {
      notifyEmployeeUser(emp.reporting_manager_id, 'leave_applied', 'New Leave Request', `${employee_name} applied for ${typeLabel} leave (${from} – ${to})`).catch(()=>{});
    } else {
      notifyAdminsAndHR('leave_applied', 'New Leave Request', `${employee_name} applied for ${typeLabel} leave (${from} – ${to})`).catch(()=>{});
    }
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Manager first-level approval
app.patch('/api/leave/requests/:id/manager-approve', async (req, res) => {
  try {
    const { status, manager_id, manager_name, rejection_reason, approver_note } = req.body;
    if (status === 'rejected') {
      const rows = await sql`
        UPDATE leave_requests
        SET manager_status='rejected', manager_id=${manager_id ?? null},
            manager_name=${manager_name ?? null},
            manager_rejection_reason=${rejection_reason ?? null},
            manager_approver_note=${approver_note ?? null},
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
        `Your ${formatLeaveLabel(leave.type, leave.slot)} leave (${from} – ${to}) was rejected by your manager.`);
      return res.json(leave);
    }
    const rows = await sql`
      UPDATE leave_requests
      SET manager_status='approved', manager_id=${manager_id ?? null},
          manager_name=${manager_name ?? null},
          manager_approver_note=${approver_note ?? null},
          manager_approved_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyAdminsAndHR('leave_applied', 'Leave Needs HR Approval',
      `${leave.employee_name}'s ${formatLeaveLabel(leave.type, leave.slot)} leave (${from} – ${to}) approved by manager — awaiting your final approval.`);
    res.json(leave);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// HR final approval
app.patch('/api/leave/requests/:id', async (req, res) => {
  try {
    const { status, actioner_name, rejection_reason, approver_note } = req.body;
    const rows = await sql`
      UPDATE leave_requests
      SET status=${status},
          hr_actioner_name=${actioner_name ?? null},
          hr_actioned_at=NOW(),
          rejection_reason=${status === 'rejected' ? (rejection_reason ?? null) : null},
          approver_note=${approver_note ?? null}
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
    const noteSuffix = approver_note?.trim() ? ` Note: ${approver_note.trim().slice(0, 200)}` : '';
    notifyEmployeeUser(leave.employee_id, status === 'approved' ? 'leave_approved' : 'leave_rejected',
      status === 'approved' ? 'Leave Approved' : 'Leave Rejected',
      `Your ${formatLeaveLabel(leave.type, leave.slot)} leave (${from} – ${to}) has been ${status}.${noteSuffix}`);
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
      `Your approved ${formatLeaveLabel(leave.type, leave.slot)} leave (${from} – ${to}) was cancelled by ${cancelled_by ?? 'admin'}.${cancellation_reason ? ' Reason: ' + cancellation_reason : ''}`);
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
    if (!(await isAdminOrHR(req))) return res.status(403).json({ error: 'Admin / HR only' });
    const { full_day, short_leave } = req.body;
    const fd = full_day != null ? Number(full_day) : null;
    const sl = short_leave != null ? Number(short_leave) : null;
    const rows = await sql`
      INSERT INTO leave_balances (employee_id, full_day, short_leave)
      VALUES (${req.params.employee_id}, ${fd ?? 0}, ${sl ?? 0})
      ON CONFLICT (employee_id) DO UPDATE SET
        full_day    = COALESCE(${fd}, leave_balances.full_day),
        short_leave = COALESCE(${sl}, leave_balances.short_leave)
      RETURNING *`;
    res.json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Backfill: HR/Admin records an optional leave the employee already took
// before this HRMS existed (or outside the normal apply flow). Creates a
// leave_requests row dated to the actual date, status=approved, type=optional.
// Skips the optional-pool / birthday validation because admin is explicitly
// asserting historical fact. The existing GET balance counts naturally
// reflect it afterwards (so 1/2 or 0/2 instead of always 2/2).
app.post('/api/leave/backfill-optional', async (req, res) => {
  try {
    if (!(await isAdminOrHR(req))) return res.status(403).json({ error: 'Admin / HR only' });
    const { employee_id, date, reason } = req.body ?? {};
    if (!employee_id || !date) return res.status(400).json({ error: 'employee_id and date are required' });
    const empRows = await sql`SELECT id, name FROM employees WHERE id=${employee_id}`;
    if (!(empRows as any[]).length) return res.status(404).json({ error: 'Employee not found' });
    const emp = (empRows as any[])[0];
    // Guard against accidental duplicate backfills for the same date.
    const dupe = await sql`
      SELECT id FROM leave_requests
      WHERE employee_id=${employee_id} AND type='optional'
        AND from_date::date = ${date}::date
        AND status NOT IN ('rejected','cancelled')`;
    if ((dupe as any[]).length) return res.status(409).json({ error: 'An optional leave already exists for that date' });
    const actor = (await sql`SELECT id, name FROM app_users WHERE id=${(req.headers['x-user-id'] as string) || ''}`)[0] as any;
    const id = `l_${Date.now()}`;
    await sql`
      INSERT INTO leave_requests
        (id, employee_id, employee_name, type, from_date, to_date, days, reason,
         status, manager_status, hr_actioner_name, hr_actioned_at)
      VALUES (${id}, ${employee_id}, ${emp.name}, 'optional', ${date}::date, ${date}::date, 1,
              ${reason?.trim() || 'Backfilled historical optional leave'},
              'approved', 'approved', ${actor?.name ?? 'HR'}, NOW())`;
    res.status(201).json({ ok: true, id });
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
    // Optional leave usage for the current calendar year. Cap is 2/year for
    // everyone; "used" includes backfilled historical entries (same shape,
    // just dated earlier) so the count naturally reflects reality without
    // any override field.
    const yearNow = new Date().getFullYear();
    const optList = await sql`
      SELECT id, from_date, reason FROM leave_requests
      WHERE employee_id=${req.params.employee_id} AND type='optional'
        AND status NOT IN ('rejected','cancelled')
        AND EXTRACT(YEAR FROM from_date)=${yearNow}
      ORDER BY from_date ASC` as any[];
    bal.optional_used = optList.length;
    bal.optional_cap = 2;
    bal.optional_remaining = Math.max(0, 2 - optList.length);
    bal.optional_taken = optList.map(r => ({
      id: r.id,
      date: typeof r.from_date === 'string' ? r.from_date.slice(0, 10) : new Date(r.from_date).toISOString().slice(0, 10),
      reason: r.reason,
    }));
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
    const {
      employee_id, reviewer_id, reviewer_name, month, year,
      productivity, quality, teamwork, attendance_score, initiative,
      client_satisfaction, ai_usage,
      // Phase 1 additions — dimensions the old 7 missed.
      communication, ownership, planning_accuracy, learning_growth,
      overall_score, comments, parameter_notes, requester_role,
    } = req.body;
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
        (employee_id, reviewer_id, reviewer_name, month, year,
         productivity, quality, teamwork, attendance_score, initiative,
         client_satisfaction, ai_usage,
         communication, ownership, planning_accuracy, learning_growth,
         overall_score, comments, parameter_notes, updated_at)
      VALUES
        (${employee_id}, ${reviewer_id ?? null}, ${reviewer_name ?? null}, ${month}, ${year},
         ${productivity}, ${quality}, ${teamwork}, ${attendance_score}, ${initiative},
         ${client_satisfaction ?? 0}, ${ai_usage ?? 75},
         ${communication ?? 75}, ${ownership ?? 75}, ${planning_accuracy ?? 75}, ${learning_growth ?? 75},
         ${overall_score}, ${comments ?? null}, ${paramNotesJson}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        reviewer_id=EXCLUDED.reviewer_id, reviewer_name=EXCLUDED.reviewer_name,
        productivity=EXCLUDED.productivity, quality=EXCLUDED.quality, teamwork=EXCLUDED.teamwork,
        attendance_score=EXCLUDED.attendance_score, initiative=EXCLUDED.initiative,
        client_satisfaction=EXCLUDED.client_satisfaction, ai_usage=EXCLUDED.ai_usage,
        communication=EXCLUDED.communication, ownership=EXCLUDED.ownership,
        planning_accuracy=EXCLUDED.planning_accuracy, learning_growth=EXCLUDED.learning_growth,
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

// ── Review signals ────────────────────────────────────────────────────────
// One-shot endpoint that returns every hard data signal the reviewer
// should see on the monthly form. Each block fails soft to {available:false}
// so a missing table or empty period doesn't kill the panel — the form
// still renders the categories that DO have data.
app.get('/api/performance/review-signals', async (req, res) => {
  try {
    await runStartupMigrations();
    const employee_id = (req.query.employee_id as string) || '';
    const month = Number(req.query.month);
    const year  = Number(req.query.year);
    if (!employee_id || !month || !year) {
      return res.status(400).json({ error: 'employee_id, month, year required' });
    }

    // Period bounds (inclusive). Used by every block below.
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    const periodEndDt = new Date(year, month, 0); // day 0 of next month = last day of this month
    const periodEnd   = periodEndDt.toISOString().slice(0, 10);

    const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); } catch { return null; }
    };

    // 1. Hours discipline — % of working days with a logged hour entry
    //    *on the day itself* vs. backfilled later. We approximate "on time"
    //    as created_at within +1 calendar day of log_date (covers next-morning
    //    catch-up which is normal). A day with zero hours logged still
    //    counts as "missed" unless it was a holiday / leave.
    const hoursDiscipline = await safe(async () => {
      const rows = await sql`
        SELECT log_date::text AS log_date, MIN(created_at) AS first_logged
        FROM hour_log_days
        WHERE employee_id=${employee_id}
          AND month=${month} AND year=${year}
        GROUP BY log_date`;
      const internal = await sql`
        SELECT log_date::text AS log_date, MIN(created_at) AS first_logged
        FROM internal_hour_logs
        WHERE employee_id=${employee_id}
          AND log_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
        GROUP BY log_date`;
      // Treat the union — any log on a day means the day is covered.
      const byDate = new Map<string, Date>();
      for (const r of [...(rows as any[]), ...(internal as any[])]) {
        const d = String(r.log_date).slice(0, 10);
        const t = r.first_logged ? new Date(r.first_logged) : null;
        if (!t) continue;
        const cur = byDate.get(d);
        if (!cur || t < cur) byDate.set(d, t);
      }
      // Working days = weekdays in the period up to today (don't penalise the future).
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);
      const isWeekend = (iso: string) => {
        const d = new Date(iso + 'T00:00:00Z');
        const dow = d.getUTCDay();
        return dow === 0 || dow === 6;
      };
      let workingDays = 0, logged = 0, onTime = 0;
      for (let day = 1; day <= periodEndDt.getDate(); day++) {
        const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (iso > todayIso) break;
        if (isWeekend(iso)) continue;
        workingDays++;
        const firstLogged = byDate.get(iso);
        if (firstLogged) {
          logged++;
          // "on time" = entry created on or by the next calendar day.
          const cutoff = new Date(iso + 'T23:59:59');
          cutoff.setDate(cutoff.getDate() + 1);
          if (firstLogged <= cutoff) onTime++;
        }
      }
      return { working_days: workingDays, logged_days: logged, on_time_days: onTime,
               coverage_pct: workingDays ? Math.round(logged * 100 / workingDays) : null,
               on_time_pct: logged ? Math.round(onTime * 100 / logged) : null };
    });

    // 2. Allocation accuracy — planned hours vs logged hours, per week.
    //    Variance closer to 0 = good planning. Sourced from project assignments.
    const allocation = await safe(async () => {
      const planned = await sql`
        SELECT COALESCE(SUM(a.allocated_hours), 0)::numeric AS planned
        FROM project_assignments a
        WHERE a.employee_id=${employee_id}
          AND ((a.month = ${month} AND a.year = ${year})
            OR (a.start_date IS NOT NULL AND a.start_date <= ${periodEnd}::date
                AND (a.end_date IS NULL OR a.end_date >= ${periodStart}::date)))` as any[];
      const logged = await sql`
        SELECT COALESCE(SUM(hours), 0)::numeric AS logged
        FROM hour_log_days
        WHERE employee_id=${employee_id} AND month=${month} AND year=${year}` as any[];
      const p = Number(planned?.[0]?.planned ?? 0);
      const l = Number(logged?.[0]?.logged ?? 0);
      if (p <= 0 && l <= 0) return null;
      return { planned: p, logged: l,
               variance_hours: Math.round((l - p) * 10) / 10,
               variance_pct: p > 0 ? Math.round((l - p) * 100 / p) : null };
    });

    // 3. Internal-hours mix — what % of approved hours were internal vs billable.
    const internalMix = await safe(async () => {
      const billable = await sql`
        SELECT COALESCE(SUM(hours), 0)::numeric AS h FROM hour_log_days
        WHERE employee_id=${employee_id} AND month=${month} AND year=${year}` as any[];
      const internal = await sql`
        SELECT COALESCE(SUM(hours), 0)::numeric AS h FROM internal_hour_logs
        WHERE employee_id=${employee_id}
          AND log_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
          AND COALESCE(status, 'approved') = 'approved'` as any[];
      const b = Number(billable?.[0]?.h ?? 0);
      const i = Number(internal?.[0]?.h ?? 0);
      const total = b + i;
      if (total === 0) return null;
      return { billable_hours: b, internal_hours: i, total_hours: total,
               internal_pct: Math.round(i * 100 / total) };
    });

    // 4. Attendance breakdown — late / short / absent counts. "with note"
    //    vs "without note" answers the unspoken question: did they explain?
    const attendance = await safe(async () => {
      const att = await sql`
        SELECT status, date::text AS date, total_hours
        FROM attendance_records
        WHERE employee_id=${employee_id}
          AND date BETWEEN ${periodStart}::date AND ${periodEnd}::date` as any[];
      const notes = await sql`
        SELECT date::text AS date FROM attendance_notes
        WHERE employee_id=${employee_id}
          AND date BETWEEN ${periodStart}::date AND ${periodEnd}::date
          AND COALESCE(status, 'approved') = 'approved'` as any[];
      const notedSet = new Set((notes as any[]).map(n => String(n.date).slice(0, 10)));
      let late = 0, short = 0, absent = 0;
      let lateNoted = 0, shortNoted = 0, absentNoted = 0;
      for (const r of att) {
        const isShort = (r.status === 'present' || r.status === 'late') &&
                        Number(r.total_hours) > 0 && Number(r.total_hours) < 8;
        if (r.status === 'late')   { late++;   if (notedSet.has(r.date)) lateNoted++; }
        if (isShort)               { short++;  if (notedSet.has(r.date)) shortNoted++; }
        if (r.status === 'absent') { absent++; if (notedSet.has(r.date)) absentNoted++; }
      }
      return { late_count: late, short_day_count: short, absent_count: absent,
               late_noted: lateNoted, short_noted: shortNoted, absent_noted: absentNoted };
    });

    // 5. Leave pattern — counts by type + Monday-Friday distribution. A
    //    "Friday spike" is the kind of pattern a reviewer wants to see at a
    //    glance.
    const leaves = await safe(async () => {
      const rows = await sql`
        SELECT type, from_date::text AS from_date, to_date::text AS to_date, days, status
        FROM leave_requests
        WHERE employee_id=${employee_id}
          AND status NOT IN ('rejected', 'cancelled')
          AND from_date <= ${periodEnd}::date AND to_date >= ${periodStart}::date` as any[];
      const byType: Record<string, number> = {};
      const dowCount = [0, 0, 0, 0, 0, 0, 0]; // Sun..Sat
      for (const r of rows) {
        byType[r.type] = (byType[r.type] ?? 0) + Number(r.days ?? 1);
        // Walk every day in the leave intersected with the period.
        const from = r.from_date > periodStart ? r.from_date : periodStart;
        const to   = r.to_date   < periodEnd   ? r.to_date   : periodEnd;
        let cur = new Date(from + 'T00:00:00Z');
        const end = new Date(to + 'T00:00:00Z');
        while (cur <= end) {
          dowCount[cur.getUTCDay()]++;
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
      return { by_type: byType,
               total_days: Object.values(byType).reduce((a, b) => a + b, 0),
               by_dow: { mon: dowCount[1], tue: dowCount[2], wed: dowCount[3],
                         thu: dowCount[4], fri: dowCount[5] } };
    });

    // 6. Comment responsiveness — for employees, median time from a
    //    manager's comment on their hour log to their reply on the same log.
    const responsiveness = await safe(async () => {
      const rows = await sql`
        SELECT c.hour_log_id, c.author_id, c.author_role, c.created_at, h.employee_id
        FROM hour_log_comments c
        JOIN hour_logs h ON h.id = c.hour_log_id
        WHERE h.employee_id=${employee_id}
          AND h.month=${month} AND h.year=${year}
        ORDER BY c.hour_log_id, c.created_at` as any[];
      const byLog = new Map<string, any[]>();
      for (const r of rows) {
        const arr = byLog.get(r.hour_log_id) ?? [];
        arr.push(r); byLog.set(r.hour_log_id, arr);
      }
      const responseHours: number[] = [];
      let promptsReceived = 0;
      for (const thread of byLog.values()) {
        for (let i = 0; i < thread.length - 1; i++) {
          const cur  = thread[i];
          const next = thread[i + 1];
          if (cur.author_id !== employee_id && next.author_id === employee_id) {
            promptsReceived++;
            const ms = new Date(next.created_at).getTime() - new Date(cur.created_at).getTime();
            responseHours.push(ms / 36e5);
          }
        }
        // Last comment unanswered by the employee = an open prompt.
        const last = thread[thread.length - 1];
        if (last && last.author_id !== employee_id) promptsReceived++;
      }
      const median = (xs: number[]) => {
        if (!xs.length) return null;
        const s = [...xs].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      };
      const med = median(responseHours);
      return { prompts_received: promptsReceived,
               replies_sent: responseHours.length,
               median_response_hours: med != null ? Math.round(med * 10) / 10 : null };
    });

    // 7. Pulse trend — last 90 days of monthly snapshots so the reviewer
    //    sees trajectory, not just a snapshot of the current month.
    const pulse = await safe(async () => {
      const rows = await sql`
        SELECT month, year, total_score, band
        FROM performance_monthly_snapshots
        WHERE employee_id=${employee_id}
        ORDER BY year DESC, month DESC
        LIMIT 6` as any[];
      if (!rows.length) return null;
      const ordered = rows.reverse();
      const cur = ordered[ordered.length - 1];
      const prev = ordered.length >= 2 ? ordered[ordered.length - 2] : null;
      return { current: Number(cur.total_score), band: cur.band,
               delta_vs_prev_month: prev ? Math.round((Number(cur.total_score) - Number(prev.total_score)) * 10) / 10 : null,
               trend: ordered.map((r: any) => ({ month: r.month, year: r.year, score: Number(r.total_score), band: r.band })) };
    });

    res.json({
      employee_id, month, year,
      hours_discipline: hoursDiscipline,
      allocation, internal_mix: internalMix,
      attendance, leaves, responsiveness, pulse,
    });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
});

// ── Self-review submit ────────────────────────────────────────────────────
// Employee files their own scores + a "what went well / what I'd do
// differently" reflection. Lands on the same monthly_performance row so
// the reviewer sees it alongside their own ratings. Idempotent — the
// employee can re-submit until the reviewer locks the row.
app.post('/api/performance/monthly/self', async (req, res) => {
  try {
    await runStartupMigrations();
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, name, role, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });

    const { employee_id, month, year, self_scores, self_went_well, self_would_do_differently } = req.body ?? {};
    if (!employee_id || !month || !year) {
      return res.status(400).json({ error: 'employee_id, month, year required' });
    }

    // Only the employee themself (or admin/HR on their behalf) can submit.
    const actorEmpId = await resolveUserToEmployee(u);
    const isPrivileged = u.role === 'admin' || u.role === 'hr_manager';
    if (!isPrivileged && actorEmpId !== employee_id) {
      return res.status(403).json({ error: "You can only file your own self-review." });
    }

    const existing = (await sql`SELECT id, is_locked FROM monthly_performance WHERE employee_id=${employee_id} AND month=${month} AND year=${year}`)[0] as any;
    if (existing?.is_locked) {
      return res.status(403).json({ error: 'Review is locked — self-review window closed.' });
    }

    const scoresJson = self_scores ? JSON.stringify(self_scores) : null;
    const row = (await sql`
      INSERT INTO monthly_performance
        (employee_id, month, year, self_scores, self_went_well, self_would_do_differently, self_submitted_at, updated_at)
      VALUES
        (${employee_id}, ${month}, ${year}, ${scoresJson}::jsonb, ${self_went_well ?? null}, ${self_would_do_differently ?? null}, NOW(), NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        self_scores               = ${scoresJson}::jsonb,
        self_went_well            = ${self_went_well ?? null},
        self_would_do_differently = ${self_would_do_differently ?? null},
        self_submitted_at         = NOW(),
        updated_at                = NOW()
      RETURNING *`)[0] as any;

    // Ping the reporting manager so they know the self-review is ready.
    try {
      notifyManagerOfEmployee(employee_id, 'self_review_submitted',
        'Self-review submitted',
        `${u.name ?? 'Employee'} filed their self-review for ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1]} ${year}.`);
    } catch {}
    res.json(row);
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Server error' }); }
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
  // New status `repair_done` slots between `returned` (laptop physically
  // back from vendor) and `awaiting_approval` (cost about to be paid).
  // Track when HR marked it verified-with-employee so the service trail
  // shows the gap between "vendor returned" and "we confirmed it works".
  await sql`ALTER TABLE repair_tickets ADD COLUMN IF NOT EXISTS repair_done_at TIMESTAMPTZ`.catch(()=>{});
  // Backfill: NULL reported_at on legacy tickets (POST used to insert literal
  // NULL which overrode the DEFAULT). Use updated_at as the best proxy we
  // have — slightly later than the actual report time but better than NULL.
  await sql`UPDATE repair_tickets SET reported_at = updated_at WHERE reported_at IS NULL AND updated_at IS NOT NULL`.catch(()=>{});
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
    // Strip admin_password for everyone except admin/HR. Employees viewing
    // their own laptop should NOT see this — it's the IT-set password used
    // for recovery, not a self-service field.
    const canSeePw = await isAdminOrHR(req);
    const out = (rows as any[]).map(r => canSeePw ? r : { ...r, admin_password: undefined });
    res.json(out);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

app.post('/api/assets', async (req, res) => {
  try {
    await ensureRepairTables();
    const { asset_tag, category_id, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes,
            brand, os, processor, ram, storage, admin_password } = req.body;
    if (!asset_tag?.trim()) return res.status(400).json({ error: 'Asset tag is required' });
    // Only admin/HR can write the password. Silently drop for everyone else
    // so a coordinator can still create the asset, just without the password.
    const canSetPw = await isAdminOrHR(req);
    const pw = canSetPw ? (admin_password?.trim() || null) : null;
    const id = `asset_${Date.now()}`;
    const rows = await sql`INSERT INTO assets
      (id, asset_tag, category_id, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes,
       brand, os, processor, ram, storage, admin_password)
      VALUES (${id}, ${asset_tag.trim()}, ${category_id ?? null}, ${model ?? null}, ${serial_no ?? null}, ${purchase_date ?? null},
              ${assigned_to_id ?? null}, ${assigned_to_name ?? null}, ${status ?? 'active'}, ${notes ?? null},
              ${brand?.trim() || null}, ${os?.trim() || null}, ${processor?.trim() || null},
              ${ram?.trim() || null}, ${storage?.trim() || null}, ${pw})
      RETURNING *`;
    res.status(201).json((rows as any[])[0]);
  } catch (e: any) {
    if (e.message?.includes('unique')) return res.status(409).json({ error: 'Asset tag already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/assets/:id', async (req, res) => {
  try {
    const { asset_tag, category_id, model, serial_no, purchase_date, assigned_to_id, assigned_to_name, status, notes,
            brand, os, processor, ram, storage, admin_password } = req.body;
    if (!asset_tag?.trim()) return res.status(400).json({ error: 'Asset tag is required' });
    const canSetPw = await isAdminOrHR(req);
    // Only update admin_password when admin/HR explicitly sends one — empty
    // string clears, undefined leaves it untouched. Non-admin writes can't
    // touch it at all.
    const shouldUpdatePw = canSetPw && admin_password !== undefined;
    const pwPatch = shouldUpdatePw ? (admin_password?.trim() || null) : null;
    const rows = shouldUpdatePw
      ? await sql`UPDATE assets SET
          asset_tag=${asset_tag.trim()}, category_id=${category_id ?? null}, model=${model ?? null},
          serial_no=${serial_no ?? null}, purchase_date=${purchase_date ?? null},
          assigned_to_id=${assigned_to_id ?? null}, assigned_to_name=${assigned_to_name ?? null},
          status=${status ?? 'active'}, notes=${notes ?? null},
          brand=${brand?.trim() || null}, os=${os?.trim() || null},
          processor=${processor?.trim() || null}, ram=${ram?.trim() || null}, storage=${storage?.trim() || null},
          admin_password=${pwPatch}
          WHERE id=${req.params.id} RETURNING *`
      : await sql`UPDATE assets SET
          asset_tag=${asset_tag.trim()}, category_id=${category_id ?? null}, model=${model ?? null},
          serial_no=${serial_no ?? null}, purchase_date=${purchase_date ?? null},
          assigned_to_id=${assigned_to_id ?? null}, assigned_to_name=${assigned_to_name ?? null},
          status=${status ?? 'active'}, notes=${notes ?? null},
          brand=${brand?.trim() || null}, os=${os?.trim() || null},
          processor=${processor?.trim() || null}, ram=${ram?.trim() || null}, storage=${storage?.trim() || null}
          WHERE id=${req.params.id} RETURNING *`;
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
      ORDER BY COALESCE(r.reported_at, r.updated_at) DESC` as any[];
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
    // Either an employee OR an asset must identify the ticket. Asset-only
    // tickets cover inventory / spare / returned-by-former-employee cases
    // where there's no person to attribute the repair to.
    if (!employee_id && !asset_id) {
      return res.status(400).json({ error: 'Either an employee or an asset must be selected.' });
    }
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
        COALESCE(${reported_at}::timestamptz, NOW()), ${isHistoric && payment_date ? payment_date : null}
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
    // Notifications. Asset-only tickets read differently: there's no person
    // to credit, so the notification focuses on the asset itself.
    let assetTag: string | null = null;
    if (asset_id) {
      try { assetTag = ((await sql`SELECT asset_tag FROM assets WHERE id=${asset_id}`)[0] as any)?.asset_tag ?? null; } catch {}
    }
    const subject = employee_name ? `${employee_name}'s asset` : assetTag ? `Asset ${assetTag}` : 'An asset';
    notifyAdminsAndHR('repair_ticket_created', 'New Repair Ticket', `${subject} reported for repair: ${issue.trim().slice(0, 60)}${issue.length > 60 ? '…' : ''}`).catch(()=>{});
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
    let repairDoneAt = t.repair_done_at;
    let requiresApproval = t.requires_approval;

    if (status && status !== t.status) {
      const now = new Date().toISOString();
      if (status === 'picked_up')        pickedUpAt = now;
      else if (status === 'returned')    returnedAt = now;
      else if (status === 'repair_done') repairDoneAt = now;
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
        repair_done_at=${repairDoneAt},
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

    // Mark asset status accordingly. repair_done is bucketed with returned/
    // paid — the device is physically usable again, the ticket just hasn't
    // closed its payment stage.
    if (updated.asset_id) {
      if (newStatus === 'returned' || newStatus === 'repair_done' || newStatus === 'paid')
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
        repair_done: 'Your laptop repair has been verified as complete.',
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
  // Backfill orphaned WFH / leave rows whose employee_id is empty or null
  // (regression from MyPortal Apply firing before the emp lookup finished).
  // Resolves by employee_name → employees.name match, only when exactly one
  // employee has that name (no risk of cross-wiring people with shared names).
  // Idempotent: subsequent runs see no empty employee_id rows.
  try {
    await sql`
      UPDATE wfh_requests w SET employee_id = e.id
      FROM employees e
      WHERE (w.employee_id IS NULL OR w.employee_id = '')
        AND LOWER(TRIM(e.name)) = LOWER(TRIM(w.employee_name))
        AND (SELECT COUNT(*) FROM employees x WHERE LOWER(TRIM(x.name)) = LOWER(TRIM(w.employee_name))) = 1`;
    await sql`
      UPDATE leave_requests l SET employee_id = e.id
      FROM employees e
      WHERE (l.employee_id IS NULL OR l.employee_id = '')
        AND LOWER(TRIM(e.name)) = LOWER(TRIM(l.employee_name))
        AND (SELECT COUNT(*) FROM employees x WHERE LOWER(TRIM(x.name)) = LOWER(TRIM(l.employee_name))) = 1`;
  } catch { /* non-fatal */ }
}
app.get('/api/wfh/requests', async (req, res) => {
  try {
    await ensureWfhTable();
    const { employee_id, status, reporting_manager_id } = req.query as any;
    let rows;
    if (reporting_manager_id) {
      // Widen match — see /api/employees for the why.
      const mgrRow = (await sql`SELECT id, employee_id FROM employees WHERE id=${reporting_manager_id} OR employee_id=${reporting_manager_id} LIMIT 1`)[0] as any;
      const cands = mgrRow ? [mgrRow.id, mgrRow.employee_id].filter(Boolean) : [reporting_manager_id];
      // Diagnostic mode — frontend can pass ?_debug=1 to get back what the
      // backend actually matched on, so we can debug "manager doesn't see X"
      // from DevTools without spelunking the DB.
      if (req.query._debug === '1') {
        const allPending = await sql`
          SELECT wr.id, wr.employee_id, wr.employee_name, wr.status, wr.manager_status,
                 e.reporting_manager_id AS report_rm
          FROM wfh_requests wr
          LEFT JOIN employees e ON e.id = wr.employee_id
          WHERE wr.status='pending' AND wr.manager_status='pending'
          ORDER BY wr.applied_on DESC LIMIT 20` as any[];
        rows = await sql`SELECT wr.* FROM wfh_requests wr JOIN employees e ON e.id=wr.employee_id WHERE e.reporting_manager_id = ANY(${cands}::text[]) AND wr.manager_status='pending' AND wr.status='pending' ORDER BY wr.applied_on DESC`;
        return res.json({ _debug: { input: reporting_manager_id, resolved_manager: mgrRow, candidates: cands, matched_count: (rows as any[]).length, all_pending_wfh_sample: allPending }, rows });
      }
      rows = await sql`SELECT wr.* FROM wfh_requests wr JOIN employees e ON e.id=wr.employee_id WHERE e.reporting_manager_id = ANY(${cands}::text[]) AND wr.manager_status='pending' AND wr.status='pending' ORDER BY wr.applied_on DESC`;
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
    let { employee_id, employee_name, date, type, reason } = req.body;
    // Defensive resolution: if employee_id is empty (frontend submitted
    // before the emp lookup finished), try to recover from x-user-id
    // header → employee link, then from employee_name. Block the request
    // outright if neither yields a real employee.
    if (!employee_id || String(employee_id).trim() === '') {
      const uid = req.header('x-user-id');
      if (uid) {
        const u = (await sql`SELECT name, email, employee_id_ref FROM app_users WHERE id=${uid}`)[0] as any;
        const resolved = u ? await resolveUserToEmployee(u) : null;
        if (resolved) employee_id = resolved;
      }
      if (!employee_id && employee_name) {
        const e = (await sql`SELECT id FROM employees WHERE LOWER(TRIM(name)) = LOWER(TRIM(${employee_name})) LIMIT 1`)[0] as any;
        if (e?.id) employee_id = e.id;
      }
      if (!employee_id) return res.status(400).json({ error: 'Could not resolve your employee record. Refresh and try again.' });
    }
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
    // employee_code = human-readable employees.employee_id (DL0067 etc).
    // app_users.employee_id_ref stores that same human code, so we JOIN on
    // both columns to be defensive against legacy rows still holding the
    // internal id from before the migration ran.
    res.json(await sql`
      SELECT u.id, u.employee_id_ref, u.name, u.email, u.role, u.department, u.designation,
             u.avatar, u.active, u.created_at,
             e.employee_id AS employee_code
      FROM app_users u
      LEFT JOIN employees e
        ON e.employee_id = u.employee_id_ref
        OR e.id = u.employee_id_ref
      ORDER BY u.name`);
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
    // Snapshot the existing row BEFORE the update so the audit row can
    // diff against it. Cheaper than RETURNING old/new in one statement
    // (Postgres doesn't expose pre-image without triggers).
    const before = (await sql`SELECT * FROM project_assignments WHERE id=${req.params.id}`)[0] as any;
    const rows = await sql`
      UPDATE project_assignments SET
        w1_hours=${w1}, w2_hours=${w2}, w3_hours=${w3}, w4_hours=${w4}, w5_hours=${w5},
        monthly_hours=${monthly}, notes=${notes ?? null}, updated_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
    const r = rows[0];
    // Audit only if a weekly value or notes actually changed. Skipping
    // no-op saves (cell focus → tab away with same value) keeps the log
    // signal-only so reviewers don't scroll through dead rows.
    if (before) {
      const changed =
        Number(before.w1_hours) !== w1 || Number(before.w2_hours) !== w2 ||
        Number(before.w3_hours) !== w3 || Number(before.w4_hours) !== w4 ||
        Number(before.w5_hours) !== w5 ||
        (before.notes ?? null) !== (notes ?? null);
      if (changed) {
        try {
          const uid = req.header('x-user-id') || null;
          const actor = uid
            ? (await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any
            : null;
          const proj = (await sql`SELECT name FROM projects WHERE id=${r.project_id}`)[0] as any;
          await sql`
            INSERT INTO project_assignment_audit (
              assignment_id, project_id, project_name, employee_id, employee_name,
              month, year,
              w1_before, w2_before, w3_before, w4_before, w5_before, monthly_before,
              w1_after,  w2_after,  w3_after,  w4_after,  w5_after,  monthly_after,
              notes_before, notes_after,
              actor_id, actor_name, actor_role
            ) VALUES (
              ${r.id}, ${r.project_id}, ${proj?.name ?? null}, ${r.employee_id}, ${r.employee_name ?? null},
              ${r.month}, ${r.year},
              ${Number(before.w1_hours)||0}, ${Number(before.w2_hours)||0}, ${Number(before.w3_hours)||0}, ${Number(before.w4_hours)||0}, ${Number(before.w5_hours)||0}, ${Number(before.monthly_hours)||0},
              ${w1}, ${w2}, ${w3}, ${w4}, ${w5}, ${monthly},
              ${before.notes ?? null}, ${notes ?? null},
              ${actor?.id ?? null}, ${actor?.name ?? null}, ${actor?.role ?? null}
            )`;
        } catch {/* audit write must never block the actual update */}
      }
    }
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

// GET /api/project-assignments/audit — list edit-audit entries with filters.
// Most recent first. Admin / HR / project_coordinator only — the activity
// log exposes per-employee allocation changes which is sensitive for a
// regular employee to browse.
app.get('/api/project-assignments/audit', async (req, res) => {
  try {
    const uid = req.header('x-user-id');
    if (!uid) return res.status(401).json({ error: 'Sign in required' });
    const u = (await sql`SELECT id, role FROM app_users WHERE id=${uid}`)[0] as any;
    if (!u) return res.status(401).json({ error: 'Unknown user' });
    if (!['admin','hr_manager','project_coordinator'].includes(u.role)) {
      return res.status(403).json({ error: 'Admin / HR / coordinator only' });
    }
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;
    const project_id  = (req.query.project_id  as string) || null;
    const employee_id = (req.query.employee_id as string) || null;
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await sql`
      SELECT *
      FROM project_assignment_audit
      WHERE (${month}::int  IS NULL OR month=${month})
        AND (${year}::int   IS NULL OR year=${year})
        AND (${project_id}::text  IS NULL OR project_id=${project_id})
        AND (${employee_id}::text IS NULL OR employee_id=${employee_id})
      ORDER BY changed_at DESC
      LIMIT ${limit}`;
    res.json(rows);
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
             ) AS day_notes,
             -- Comment thread depth so the UI can badge "has discussion" rows
             -- without an extra round-trip per row.
             (SELECT COUNT(*) FROM hour_log_comments c WHERE c.hour_log_id = hl.id)::int AS comment_count
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
        AND (${reviewer_id}::text IS NULL
             OR p.project_reporting_id=${reviewer_id}
             OR p.project_lead_id=${reviewer_id})
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
      const p = await sql`SELECT name, project_reporting_id, project_lead_id FROM projects WHERE id=${project_id}`;
      const projRow = (p as any[])[0];
      // Notify both the project_reporting_id (designated reviewer) AND
      // the project_lead_id when set, so a lead who isn't the reporter
      // still sees the approval task land in their bell. Dedup against
      // the same id to avoid double-pinging when one person holds both
      // roles.
      const recipients = new Set<string>();
      if (projRow?.project_reporting_id) recipients.add(projRow.project_reporting_id);
      if (projRow?.project_lead_id)      recipients.add(projRow.project_lead_id);
      if (recipients.size > 0) {
        for (const empId of recipients) {
          notifyEmployeeUser(empId, 'hours_logged',
            'Hours Submitted for Review',
            `${req.body.employee_name || 'An employee'} logged ${hours_logged}h on ${projRow.name} (W${week_num})`).catch(()=>{});
        }
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
    // Wipe the per-day rows that fed this weekly log too. Without this,
    // recomputeWeeklyFromDays would resurrect the parent on the next
    // upsert/edit and the employee would see the deletion silently
    // reverted. hour_log_days is keyed by (assignment_id, week_num) so we
    // target the exact week being removed.
    await sql`DELETE FROM hour_log_days WHERE assignment_id=${cur.assignment_id} AND week_num=${cur.week_num}`.catch(()=>{});
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

// PATCH /api/hour-logs/:id/hold — middle state between Pending and
// Approved/Rejected. Reviewer parks the log while they wait on the
// employee's justification or clarification. A required `note` becomes
// the first comment on the thread so the employee instantly sees what's
// being asked. Reviewer can later flip on_hold → approved or → rejected
// using the existing approve/reject endpoints (no special handling needed,
// since they just overwrite status). Reason is stored on rejection_reason
// for parity with the existing "reason on the row" pattern.
app.patch('/api/hour-logs/:id/hold', async (req, res) => {
  try {
    const { reviewer_id, reviewer_name, reviewer_role, note } = req.body ?? {};
    if (!note?.trim()) return res.status(400).json({ error: 'A note explaining the hold is required' });
    const pre = await sql`SELECT hours_logged, status, work_description FROM hour_logs WHERE id=${req.params.id}`;
    const cur = (pre as any[])[0];
    if (!cur) return res.status(404).json({ error: 'Log not found' });
    const rows = await sql`
      UPDATE hour_logs SET status='on_hold',
        rejection_reason=${note.trim()},
        reviewed_by_id=${reviewer_id ?? null}, reviewed_by_name=${reviewer_name ?? null},
        reviewed_at=NOW(), updated_at=NOW()
      WHERE id=${req.params.id} RETURNING *`;
    const r = rows[0];
    // Add the hold note as the first message on the comment thread.
    await sql`INSERT INTO hour_log_comments (id, hour_log_id, author_id, author_name, author_role, body)
              VALUES (${`hlc_${Date.now()}`}, ${r.id}, ${reviewer_id ?? null}, ${reviewer_name ?? null},
                      ${reviewer_role ?? 'reviewer'}, ${note.trim()})`;
    await recordHourLogAudit({
      hour_log_id: r.id,
      action: 'on_hold',
      actor_id: reviewer_id ?? null,
      actor_name: reviewer_name ?? null,
      actor_role: 'reviewer',
      before: cur ? { hours_logged: cur.hours_logged, status: cur.status, work_description: cur.work_description } : null,
      after:  { hours_logged: r.hours_logged, status: r.status, work_description: r.work_description },
      reason: note.trim(),
    });
    try {
      const proj = await sql`SELECT name FROM projects WHERE id=${r.project_id}`;
      const projectName = (proj as any[])[0]?.name || 'a project';
      notifyEmployeeUser(r.employee_id, 'hours_on_hold',
        'Hours Held — clarification needed',
        `${reviewer_name || 'Your reviewer'} put your ${r.hours_logged}h on ${projectName} (W${r.week_num}) on hold: ${note.trim().slice(0, 140)}`,
        // Carry the log's own month/year so MyHoursTab can switch the
        // month picker to the right period before searching for the
        // log. Without these, a comment on a past month's log opened
        // an empty page because MyHoursTab defaults to the current
        // month and the target id was never in the loaded set.
        `/my?tab=my-hours&logId=${r.id}&discuss=1&m=${r.month}&y=${r.year}`).catch(()=>{});
    } catch {}
    res.json(r);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// GET /api/hour-logs/:id/comments — list comments in chronological order.
// Returned shape mirrors what the UI renders directly so no client-side
// reshaping is needed.
app.get('/api/hour-logs/:id/comments', async (req, res) => {
  try {
    const rows = await sql`SELECT id, author_id, author_name, author_role, body, created_at
                           FROM hour_log_comments
                           WHERE hour_log_id=${req.params.id}
                           ORDER BY created_at ASC`;
    res.json(rows);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// POST /api/hour-logs/:id/comments — anyone signed in can comment. We
// notify "the other side" of the conversation so the thread doesn't go
// silent: if the employee replied, ping the reviewer; if anyone else
// replied, ping the employee. This keeps the back-and-forth moving without
// requiring polling.
app.post('/api/hour-logs/:id/comments', async (req, res) => {
  try {
    const { author_id, author_name, author_role, body } = req.body ?? {};
    if (!body?.trim()) return res.status(400).json({ error: 'Body is required' });
    // Fetch id + month + year too so the deep-link in the notification
    // resolves correctly. Without these, /my?tab=my-hours&logId=…&m=…&y=…
    // was being built with all three slots as `undefined`, and the
    // employee's bell click landed on an empty MyHoursTab that couldn't
    // find a log to open the discussion modal against.
    const log = (await sql`SELECT id, month, year, employee_id, employee_name, project_id, week_num, reviewed_by_id, hours_logged FROM hour_logs WHERE id=${req.params.id}`)[0] as any;
    if (!log) return res.status(404).json({ error: 'Log not found' });
    const id = `hlc_${Date.now()}`;
    const row = (await sql`
      INSERT INTO hour_log_comments (id, hour_log_id, author_id, author_name, author_role, body)
      VALUES (${id}, ${req.params.id}, ${author_id ?? null}, ${author_name ?? null}, ${author_role ?? null}, ${body.trim()})
      RETURNING *`)[0];
    try {
      const proj = await sql`SELECT name FROM projects WHERE id=${log.project_id}`;
      const projectName = (proj as any[])[0]?.name || 'a project';
      const fromEmployee = author_id && author_id === log.employee_id;
      // Reviewer-side deep-link → opens the same modal on /hours/approvals
      // by also accepting ?logId. Employee-side deep-link → My Hours tab
      // with auto-open of the discussion modal for the matching log.
      // m/y carry the log's period so the employee's My Hours picker
      // switches to that month before searching — otherwise comments on
      // a past month's log opened an empty page with no modal.
      const reviewerLink = `/hours/approvals?logId=${log.id}&discuss=1&m=${log.month}&y=${log.year}`;
      const employeeLink = `/my?tab=my-hours&logId=${log.id}&discuss=1&m=${log.month}&y=${log.year}`;

      // ── @mentions ─────────────────────────────────────────────────────────
      // Mentions are stored inline as `@[Display Name](emp_<id>)` — the
      // format the client emits when the mention picker confirms a pick.
      // We extract the emp ids, de-dupe, drop the comment author (no
      // self-pings) and ping each via the standard notification helper.
      // Anyone who would already have been pinged by the "other side" rule
      // below is suppressed in `pinged` so they don't get two notifications.
      const pinged = new Set<string>();
      const mentionRe = /@\[[^\]]+\]\(([^)]+)\)/g;
      const mentionedIds = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = mentionRe.exec(body)) !== null) {
        const empId = m[1];
        if (empId && empId !== author_id) mentionedIds.add(empId);
      }
      if (mentionedIds.size) {
        // Strip the markup so the notification body reads cleanly.
        const cleanBody = body.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').trim().slice(0, 140);
        for (const empId of mentionedIds) {
          notifyEmployeeUser(empId, 'hours_mention',
            `${author_name || 'Someone'} mentioned you`,
            `${author_name || 'Someone'} tagged you on ${projectName} (W${log.week_num}): ${cleanBody}`,
            // Tagged people land on /my so they see their own /hours view;
            // if they happen to be the reviewer for this log they can still
            // open it from the bell. Cheap heuristic, works for both sides.
            employeeLink).catch(() => {});
          pinged.add(empId);
        }
      }

      if (fromEmployee && log.reviewed_by_id && !pinged.has(log.reviewed_by_id)) {
        // Employee replied — ping the reviewer who held / reviewed it.
        notifyEmployeeUser(log.reviewed_by_id, 'hours_comment',
          `${log.employee_name || 'Employee'} replied on hours`,
          `${log.employee_name || 'Employee'} commented on ${projectName} (W${log.week_num}): ${body.trim().slice(0, 140)}`,
          reviewerLink).catch(()=>{});
      } else if (!fromEmployee && !pinged.has(log.employee_id)) {
        // Reviewer/admin/HR commented — ping the employee.
        notifyEmployeeUser(log.employee_id, 'hours_comment',
          `New comment on your hours`,
          `${author_name || 'Reviewer'} commented on your ${projectName} (W${log.week_num}) log: ${body.trim().slice(0, 140)}`,
          employeeLink).catch(()=>{});
      }
    } catch {}
    res.status(201).json(row);
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
    // Approved internal-activity hours per week. Week is derived from
    // log_date — days 1-7 = W1, 8-14 = W2, 15-21 = W3, 22-28 = W4,
    // 29-31 = W5. Matches the same boundary used elsewhere. Only
    // approved rows count (mirrors project hour_logs).
    const internalSums = await sql`
      SELECT employee_id,
        SUM(CASE WHEN EXTRACT(DAY FROM log_date) BETWEEN 1 AND 7   THEN hours ELSE 0 END)::numeric AS w1_internal,
        SUM(CASE WHEN EXTRACT(DAY FROM log_date) BETWEEN 8 AND 14  THEN hours ELSE 0 END)::numeric AS w2_internal,
        SUM(CASE WHEN EXTRACT(DAY FROM log_date) BETWEEN 15 AND 21 THEN hours ELSE 0 END)::numeric AS w3_internal,
        SUM(CASE WHEN EXTRACT(DAY FROM log_date) BETWEEN 22 AND 28 THEN hours ELSE 0 END)::numeric AS w4_internal,
        SUM(CASE WHEN EXTRACT(DAY FROM log_date) >= 29              THEN hours ELSE 0 END)::numeric AS w5_internal,
        SUM(hours)::numeric AS month_internal
      FROM internal_hour_logs
      WHERE EXTRACT(MONTH FROM log_date) = ${month}
        AND EXTRACT(YEAR  FROM log_date) = ${year}
        AND status='approved'
      GROUP BY employee_id`;
    const internalMap = new Map<string, any>();
    for (const r of internalSums as any[]) internalMap.set(r.employee_id, r);
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
      const internal = internalMap.get(e.employee_id) || {};
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
        // Approved internal-activity hours per week (and month total).
        // Surfaced as a separate sub-column on Capacity / Mine so
        // project-hours readers stay clean.
        w1_internal: Number(internal.w1_internal ?? 0),
        w2_internal: Number(internal.w2_internal ?? 0),
        w3_internal: Number(internal.w3_internal ?? 0),
        w4_internal: Number(internal.w4_internal ?? 0),
        w5_internal: Number(internal.w5_internal ?? 0),
        month_internal: Number(internal.month_internal ?? 0),
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

    // Eligible = ALL active employees. We now expect everyone to log daily
    // — people without project allocations log against internal activities.
    // Sub-tree filter applied when scopeIds is set.
    const eligible = await sql`
      SELECT DISTINCT e.id, e.name, e.designation, e.department,
             e.reporting_manager_id, m.name AS reporting_manager_name,
             (SELECT COUNT(*) FROM project_assignments pa
                WHERE pa.employee_id = e.id AND pa.month=${month} AND pa.year=${year}) AS assignment_count
      FROM employees e
      LEFT JOIN employees m ON m.id = e.reporting_manager_id
      WHERE e.status='active'
        AND (${scopeIds}::text[] IS NULL OR e.id = ANY(${scopeIds}::text[]))
      ORDER BY e.name`;

    // Who DID log on the given date — sum hours from hour_log_days AND
    // internal_hour_logs. Either source counts toward "logged today".
    const projectLogged = await sql`
      SELECT employee_id, SUM(COALESCE(hours, 0))::numeric AS hours_today
      FROM hour_log_days
      WHERE log_date = ${dateStr}
      GROUP BY employee_id`;
    const internalLogged = await sql`
      SELECT employee_id, SUM(COALESCE(hours, 0))::numeric AS hours_today
      FROM internal_hour_logs
      WHERE log_date = ${dateStr} AND status='approved'
      GROUP BY employee_id`;
    const loggedMap = new Map<string, number>();
    for (const r of projectLogged as any[]) loggedMap.set(r.employee_id, Number(r.hours_today));
    for (const r of internalLogged as any[]) {
      loggedMap.set(r.employee_id, (loggedMap.get(r.employee_id) ?? 0) + Number(r.hours_today));
    }

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

  // Pull everyone who's still on the meta as active PLUS anyone who has
  // an exit_date (regardless of meta.active) so a separated employee
  // still appears in their exit month for proration. From the month
  // AFTER their exit we don't pull them at all — the WHERE clause does
  // the cutoff. salary_factor is the proration multiplier applied
  // below: 0..1 for the exit month, 1 for months before exit, 0 for
  // anyone whose exit_date is before the period (filtered out anyway).
  const periodFirstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const periodLastDay = (() => {
    const d = new Date(Date.UTC(year, month, 0));
    return d.toISOString().slice(0, 10);
  })();
  const employees = (await sql`
    SELECT e.id, e.name, e.designation, e.department, e.reporting_manager_id,
           COALESCE(e.salary,0) AS salary, m.cost_type, m.capacity_hours,
           e.exit_date::text AS exit_date,
           e.exit_salary_override
    FROM employees e
    LEFT JOIN fin_employee_meta m ON m.employee_id = e.id
    WHERE (
            (m.active = TRUE AND (e.exit_date IS NULL OR e.exit_date >= ${periodFirstDay}::date))
            OR
            (e.exit_date IS NOT NULL
              AND e.exit_date >= ${periodFirstDay}::date
              AND e.exit_date <= ${periodLastDay}::date)
          )`) as any[];
  // Proration: when an employee exited inside this period we recompute
  // their salary contribution. Two paths:
  //   1. exit_salary_override is set → use it verbatim. Admin used this
  //      to bake in leave encashment, bonuses, deductions etc. that
  //      working-day proration can't compute.
  //   2. otherwise → salary × worked_working_days / total_working_days
  //      where working days = Mon-Fri excluding holidays in this period.
  //      Matches "1 day = salary / 22" math the user described.
  // salary_factor and salary_prorated_* are preserved on the row so a
  // future UI hint can render "prorated to 12 of 22 working days
  // (₹X)" without recomputing.
  const monthHolidays = (await sql`
    SELECT date::text AS d FROM holidays
    WHERE date::date >= ${periodFirstDay}::date
      AND date::date <= ${periodLastDay}::date`) as any[];
  const holidaySet = new Set<string>(monthHolidays.map(r => r.d));
  // Count Mon-Fri days in [from, to] inclusive that aren't holidays.
  const countWorkingDays = (from: Date, to: Date): number => {
    let n = 0;
    for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.getUTCDay();
      if (day === 0 || day === 6) continue; // Sun/Sat
      const iso = d.toISOString().slice(0, 10);
      if (holidaySet.has(iso)) continue;
      n++;
    }
    return n;
  };
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const lastDay  = new Date(Date.UTC(year, month, 0));
  const totalWorkingDays = countWorkingDays(firstDay, lastDay);
  for (const e of employees) {
    if (!e.exit_date) { e.salary_factor = 1; continue; }
    const fullSalary = Number(e.salary);
    if (e.exit_salary_override !== null && e.exit_salary_override !== undefined) {
      // Manual override wins. Record the implied factor so downstream
      // surfaces can show "X of Y working days" + the override flag.
      const override = Number(e.exit_salary_override);
      e.salary_factor = fullSalary > 0 ? override / fullSalary : 0;
      e.salary_override_used = true;
      e.salary = override;
    } else {
      const ed = new Date(String(e.exit_date).slice(0, 10) + 'T00:00:00Z');
      const exitDate = ed < firstDay ? firstDay : ed > lastDay ? lastDay : ed;
      const workedDays = countWorkingDays(firstDay, exitDate);
      e.salary_factor = totalWorkingDays > 0 ? workedDays / totalWorkingDays : 0;
      e.salary_prorated_days = workedDays;
      e.salary_prorated_total_days = totalWorkingDays;
      e.salary = fullSalary * e.salary_factor;
    }
  }
  // Include archived projects that had ANY activity in the period —
  // allocations, logged hours, or invoices. A project closed mid-month
  // still incurred salary cost and may have raised invoices before
  // closure; dropping it from the roll-up understates direct cost and
  // hides revenue that was actually earned. Active projects are always
  // in. Archived projects only show when they had monthly_hours > 0,
  // an approved log, or a non-cancelled invoice this month.
  const projects = (await sql`
    SELECT id, name, client_name, project_lead_id, project_reporting_id, status, billing_source
    FROM projects
    WHERE status='active'
       OR id IN (
         SELECT project_id FROM project_assignments
           WHERE month=${month} AND year=${year} AND COALESCE(monthly_hours,0) > 0
         UNION
         SELECT project_id FROM hour_logs
           WHERE month=${month} AND year=${year} AND status='approved'
         UNION
         SELECT project_id FROM fin_project_invoices
           WHERE month=${month} AND year=${year} AND status <> 'cancelled'
         UNION
         SELECT project_id FROM fin_project_revenue
           WHERE month=${month} AND year=${year}
       )`) as any[];
  // For the org-wide INVOICED / RECEIVED / PENDING tiles we need every
  // non-cancelled invoice in the period — not just those tied to an active
  // project. Otherwise an invoice on an archived project shows on the
  // Invoices tab but disappears from the dashboard total. Project map keeps
  // billing_source so we can decide whether Upwork billing setup should
  // contribute in the absence of an invoice.
  const allProjects = (await sql`SELECT id, billing_source, status FROM projects`) as any[];
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
    // For direct / retainer projects, INVOICES are the only revenue path.
    // The Billing Setup tab in the UI filters to Upwork-only, so any
    // fin_project_revenue row that exists for a non-Upwork project is a
    // legacy entry admin can't see or maintain. Counting it would surface
    // phantom revenue (₹4,786 on an empty client) that doesn't belong in
    // the books for this month. So we only consult fin_project_revenue
    // for projects whose billing_source is explicitly 'upwork'.
    if (p.billing_source !== 'upwork') return 0;
    // Archived projects don't accrue billing-setup revenue automatically.
    // The Billing setup tab filters to active projects only, so once a
    // project is archived admin can't see or maintain the row — any
    // monthly recurring amount sitting in fin_project_revenue would
    // surface as phantom income (same trap the direct-project guard
    // above catches). For archived projects, invoices remain the only
    // revenue path; if you actually earned something during a closed
    // project's wind-down, raise an invoice for it.
    if (p.status === 'archived') return 0;
    const r = revByProj.get(p.id);
    if (!r) return 0;
    // Billing Setup (Upwork): same accrual rule as invoices — the
    // configured monthly amount counts as expected revenue from the
    // moment it's set up. Clearance converts expected → actual.
    //   cleared    → received_inr  (real INR that landed in the bank)
    //   anything   → revenue_inr   (expected INR for the period)
    // The variance between expected and received (Upwork fees, FX swing,
    // withdrawal timing) flows through to net profit on clearance.
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
  // Org-wide revenue/invoiced/received: built once over the full set of
  // non-cancelled invoices + Upwork billing rows for the period (not limited
  // to active projects), so the dashboard tiles agree with each other and
  // with the Invoices tab. Per-project P&L rows below stay active-only.
  const orgFinTotals = (() => {
    let totalRevenue = 0, totalInvoiced = 0, totalReceived = 0;
    let pendingInvoiceCount = 0, clearedInvoiceCount = 0;
    const accountedByInvoice = new Set<string>();
    for (const [pid, inv] of invoiceByProj) {
      accountedByInvoice.add(pid);
      totalRevenue += Number((inv as any).realized || 0);
      totalInvoiced += Number((inv as any).invoiced || 0);
      totalReceived += Number((inv as any).received || 0);
      pendingInvoiceCount += Number((inv as any).pending_count || 0);
      clearedInvoiceCount += Number((inv as any).cleared_count || 0);
    }
    const upworkProjIds = new Set(allProjects.filter(p => p.billing_source === 'upwork').map(p => p.id));
    for (const [pid, r] of revByProj) {
      if (accountedByInvoice.has(pid)) continue; // invoice wins (same precedence as revenueOf)
      if (!upworkProjIds.has(pid)) continue;     // only Upwork billing contributes here
      const invoicedInr = Number((r as any).revenue_inr || 0);
      if (invoicedInr <= 0) continue;
      totalInvoiced += invoicedInr;
      if ((r as any).status === 'cleared') {
        const recInr = Number((r as any).received_inr || 0);
        totalRevenue  += recInr;       // realized = received (post-fee/FX truth)
        totalReceived += recInr;
        clearedInvoiceCount += 1;
      } else {
        totalRevenue += invoicedInr;   // realized = invoiced for pending rows
        pendingInvoiceCount += 1;
      }
    }
    return { totalRevenue, totalInvoiced, totalReceived, pendingInvoiceCount, clearedInvoiceCount };
  })();
  const totalRevenue = orgFinTotals.totalRevenue;
  // Overhead distribution must sum to ~1 across active projects, so it uses
  // the active-project revenue sum (not the comprehensive total). Otherwise
  // revenue-method overhead would leave a portion of the pool unallocated.
  const activeProjRevenue = projects.reduce((s, p) => s + revenueOf(p), 0);
  const shareOf = (dh: number, rev: number) => {
    switch (settings.overhead_method) {
      case 'direct_hours': return totalDirectHours > 0 ? dh / totalDirectHours : 0;
      case 'revenue': return activeProjRevenue > 0 ? rev / activeProjRevenue : 0;
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
      // Surface project status so the dashboard can badge archived
      // rows. Archived projects only land here when they had period
      // activity (allocation / logs / invoices) — finance still owes
      // a row for the cost they incurred before closure.
      status: p.status || 'active',
      // Did fin_project_revenue carry a row counted toward revenue for
      // this period? Only true for ACTIVE Upwork projects. Direct
      // projects use invoices only; archived projects (even Upwork)
      // skip billing-setup revenue since admin can't maintain them.
      has_billing_setup: !!r && p.billing_source === 'upwork' && p.status === 'active',
      // Flag rows that exist in the DB but aren't counted so the
      // drilldown can warn admin. Two cases:
      //   - Direct-project legacy row (Billing setup tab is Upwork-only)
      //   - Upwork row on an archived project (Billing setup tab is
      //     status=active-only)
      has_legacy_billing_row: !!r && (
        p.billing_source !== 'upwork' || p.status === 'archived'
      ),
      billing_source: p.billing_source || 'direct',
      // Status of the Billing-setup row (pending / cleared_pending /
      // cleared). Counts toward revenue ONLY when cleared. Surfaced so
      // the drilldown can explain "₹0 — awaiting clearance" instead of
      // silently showing the expected amount.
      billing_status: r?.status || null,
      billing_received_inr: r?.received_inr != null ? Number(r.received_inr) : null,
      billing_currency: r?.currency || 'INR',
      billing_fx_rate: Number(r?.fx_rate || 1),
      billing_revenue_inr: Number(r?.revenue_inr || 0),
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
  // Project expenses: sum over the full set, not just active-project rows.
  // A project archived mid-month can still have expenses booked against it
  // that need to hit total cost.
  const totalProjectExpenses = projExpenses.reduce((s, e) => s + Number(e.amount), 0);
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
      // Tile aggregates flow from orgFinTotals (computed once above). The
      // headline tiles (REVENUE, INVOICED, RECEIVED, PENDING) all share this
      // source so they can't drift apart.
      totalInvoiced: orgFinTotals.totalInvoiced,
      totalReceived: orgFinTotals.totalReceived,
      totalPending: Math.max(orgFinTotals.totalInvoiced - orgFinTotals.totalReceived, 0),
      pendingInvoiceCount: orgFinTotals.pendingInvoiceCount,
      clearedInvoiceCount: orgFinTotals.clearedInvoiceCount,
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
    // Refuse to overwrite a cleared or awaiting-approval row from this
    // endpoint. Cleared → admin must reopen. cleared_pending → either
    // wait for admin decision or withdraw the request first. Prevents
    // accidental "edit billing setup" wiping a received-amount record
    // or silently changing the numbers admin is reviewing.
    const existing = (await sql`SELECT status FROM fin_project_revenue WHERE project_id=${project_id} AND month=${Number(month)} AND year=${Number(year)}`)[0] as any;
    if (existing?.status === 'cleared') {
      return res.status(409).json({ error: 'This billing entry is already cleared. Reopen it first to edit.' });
    }
    if (existing?.status === 'cleared_pending') {
      return res.status(409).json({ error: 'This billing entry is awaiting admin approval. Withdraw the clearance request first to edit.' });
    }
    const beforeRow = (await sql`SELECT * FROM fin_project_revenue WHERE project_id=${project_id} AND month=${Number(month)} AND year=${Number(year)}`)[0] as any;
    const afterRow = (await sql`
      INSERT INTO fin_project_revenue (project_id, month, year, billing_type, fixed_amount, hourly_rate, billable_hours, currency, fx_rate, revenue_inr, status)
      VALUES (${project_id}, ${Number(month)}, ${Number(year)}, ${billing_type || 'fixed'},
              ${fa}, ${hr}, ${bh}, ${ccy}, ${rate}, ${revenueInr}, 'pending')
      ON CONFLICT (project_id, month, year) DO UPDATE SET
        billing_type = EXCLUDED.billing_type, fixed_amount = EXCLUDED.fixed_amount,
        hourly_rate = EXCLUDED.hourly_rate, billable_hours = EXCLUDED.billable_hours,
        currency = EXCLUDED.currency, fx_rate = EXCLUDED.fx_rate, revenue_inr = EXCLUDED.revenue_inr,
        status = COALESCE(fin_project_revenue.status, 'pending')
      RETURNING *`)[0];
    // Only log if anything actually moved. Re-saving the same row with
    // identical values is a no-op from a record-keeping POV; skipping
    // keeps the activity log signal-only.
    if (gate.ok) {
      const beforeNative = beforeRow
        ? (beforeRow.billing_type === 'hourly' ? Number(beforeRow.hourly_rate||0) * Number(beforeRow.billable_hours||0) : Number(beforeRow.fixed_amount||0))
        : null;
      const afterNative = afterRow.billing_type === 'hourly' ? Number(afterRow.hourly_rate||0) * Number(afterRow.billable_hours||0) : Number(afterRow.fixed_amount||0);
      const changed = !beforeRow ||
        beforeNative !== afterNative ||
        beforeRow.currency !== afterRow.currency ||
        beforeRow.billing_type !== afterRow.billing_type;
      if (changed) {
        const proj = (await sql`SELECT name FROM projects WHERE id=${project_id}`)[0] as any;
        logRevenueAudit('saved', beforeRow ?? null, afterRow, gate.user, proj?.name ?? null);
      }
    }
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// Mark an Upwork billing entry as received. Admin enters the actual amount
// (in the same currency the entry was raised), we look up the FX rate as-of
// today and lock the INR equivalent — so realized revenue uses real money,
// not the optimistic invoiced figure.
app.patch('/api/finance/revenue/:project_id/:month/:year/clear', async (req, res) => {
  await runStartupMigrations();
  // Same workflow as Invoices: coord can request clearance (lands in
  // 'cleared_pending' awaiting admin), admin's call goes straight to
  // 'cleared'. Mirrors the pattern shipped in c02251b for invoices.
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const { project_id, month, year } = req.params;
    const mY = Number(month), yY = Number(year);
    const row = (await sql`SELECT r.*, p.name AS project_name, p.billing_source FROM fin_project_revenue r LEFT JOIN projects p ON p.id=r.project_id WHERE r.project_id=${project_id} AND r.month=${mY} AND r.year=${yY}`)[0] as any;
    if (!row) return res.status(404).json({ error: 'No billing entry for this period' });
    const isAdmin = gate.user?.role === 'admin';
    if (row.status === 'cleared' && isAdmin) {
      return res.status(400).json({ error: 'Billing already cleared — edit it instead' });
    }
    if (!isAdmin && row.status === 'cleared_pending' && row.cleared_by !== gate.user?.id) {
      return res.status(403).json({ error: 'Only the requester or an admin can update this clearance' });
    }
    const invoiced = Number(row.revenue_inr ?? 0);
    const invoicedNative = row.billing_type === 'hourly'
      ? Number(row.hourly_rate) * Number(row.billable_hours)
      : Number(row.fixed_amount);
    const { amount_received, clearance_note, fx_rate: clientRate } = req.body ?? {};
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
    const newStatus = isAdmin ? 'cleared' : 'cleared_pending';
    const updated = (await sql`
      UPDATE fin_project_revenue SET
        status=${newStatus},
        amount_received=${received},
        received_inr=${receivedInr},
        received_fx_rate=${rate},
        cleared_at=NOW(),
        cleared_by=${gate.user?.id ?? null},
        cleared_by_name=${gate.user?.name ?? null},
        clearance_note=${clearance_note?.trim() || null}
      WHERE project_id=${project_id} AND month=${mY} AND year=${yY}
      RETURNING *`)[0];
    logRevenueAudit(isAdmin ? 'cleared' : 'clear_requested', row, updated, gate.user, row.project_name);
    if (isAdmin) {
      // Admin cleared directly — ping admins/HR for the activity feed.
      const variance = receivedInr - invoiced;
      const varianceMsg = Math.abs(variance) < 1 ? 'paid in full' : variance < 0 ? `short by ₹${Math.round(Math.abs(variance)).toLocaleString('en-IN')}` : `extra ₹${Math.round(variance).toLocaleString('en-IN')}`;
      notifyAdminsAndHR('invoice_cleared', 'Upwork billing cleared',
        `${row.project_name ?? 'Project'} (${ccy} ${received.toLocaleString('en-IN')}) — ${varianceMsg}.`).catch(() => {});
    } else {
      // Coord requested — ping admins for final approval.
      notifyAdminsAndHR('invoice_clear_requested',
        'Billing clearance awaiting your approval',
        `${gate.user?.name ?? 'A coordinator'} marked ${row.project_name ?? 'a project'} billing as cleared for ${ccy} ${received.toLocaleString('en-IN')}. Open Finance → Billing setup to approve.`
      ).catch(() => {});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// PATCH .../approve-clearance — admin promotes a coord-submitted
// cleared_pending billing row to cleared. Notifies the coord.
app.patch('/api/finance/revenue/:project_id/:month/:year/approve-clearance', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { project_id, month, year } = req.params;
    const mY = Number(month), yY = Number(year);
    const row = (await sql`SELECT r.*, p.name AS project_name FROM fin_project_revenue r LEFT JOIN projects p ON p.id=r.project_id WHERE r.project_id=${project_id} AND r.month=${mY} AND r.year=${yY}`)[0] as any;
    if (!row) return res.status(404).json({ error: 'No billing entry for this period' });
    if (row.status !== 'cleared_pending') {
      return res.status(400).json({ error: `Billing is ${row.status}, not awaiting clearance approval` });
    }
    const updated = (await sql`
      UPDATE fin_project_revenue SET status='cleared'
      WHERE project_id=${project_id} AND month=${mY} AND year=${yY}
      RETURNING *`)[0];
    const adminUser = (await sql`SELECT id, name FROM app_users WHERE id=${(req.headers['x-user-id'] as string) || ''}`)[0] as any;
    logRevenueAudit('cleared', row, updated, { id: adminUser?.id ?? null, name: adminUser?.name ?? null, role: 'admin' }, row.project_name);
    if (row.cleared_by && row.cleared_by !== adminUser?.id) {
      const ccy = (row.currency || 'INR').toUpperCase();
      notifyUser(row.cleared_by, 'invoice_cleared',
        'Billing clearance approved ✅',
        `${row.project_name ?? 'Billing'}: ${ccy} ${Number(row.amount_received).toLocaleString('en-IN')} received — confirmed.`
      ).catch(() => {});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// PATCH .../reject-clearance — admin bounces back to pending with a
// reason. Body { rejection_reason }. Notifies the coord.
app.patch('/api/finance/revenue/:project_id/:month/:year/reject-clearance', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const { project_id, month, year } = req.params;
    const mY = Number(month), yY = Number(year);
    const { rejection_reason } = req.body ?? {};
    if (!rejection_reason?.trim()) return res.status(400).json({ error: 'rejection_reason is required' });
    const row = (await sql`SELECT r.*, p.name AS project_name FROM fin_project_revenue r LEFT JOIN projects p ON p.id=r.project_id WHERE r.project_id=${project_id} AND r.month=${mY} AND r.year=${yY}`)[0] as any;
    if (!row) return res.status(404).json({ error: 'No billing entry for this period' });
    if (row.status !== 'cleared_pending') {
      return res.status(400).json({ error: `Billing is ${row.status}, not awaiting clearance approval` });
    }
    const requester = row.cleared_by;
    const updated = (await sql`
      UPDATE fin_project_revenue SET
        status='pending',
        amount_received=NULL, received_inr=NULL, received_fx_rate=NULL,
        cleared_at=NULL, cleared_by=NULL, cleared_by_name=NULL, clearance_note=NULL
      WHERE project_id=${project_id} AND month=${mY} AND year=${yY}
      RETURNING *`)[0];
    const adminActor = (await sql`SELECT id, name FROM app_users WHERE id=${(req.headers['x-user-id'] as string) || ''}`)[0] as any;
    logRevenueAudit('clear_rejected', row, updated, { id: adminActor?.id ?? null, name: adminActor?.name ?? null, role: 'admin' }, row.project_name);
    if (requester) {
      notifyUser(requester, 'invoice_clear_rejected',
        'Billing clearance needs revision',
        `Admin rejected the clearance on ${row.project_name ?? 'a project'}: ${rejection_reason.trim().slice(0, 200)}`
      ).catch(() => {});
    }
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
  // Admin can reopen any row. Coord can withdraw their OWN pending
  // clearance request (status='cleared_pending' AND cleared_by = them).
  // This matches the Invoices "Withdraw request" affordance.
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const { project_id, month, year } = req.params;
    const mY = Number(month), yY = Number(year);
    const isAdmin = gate.user?.role === 'admin';
    if (!isAdmin) {
      const cur = (await sql`SELECT status, cleared_by FROM fin_project_revenue WHERE project_id=${project_id} AND month=${mY} AND year=${yY}`)[0] as any;
      if (!cur) return res.status(404).json({ error: 'Billing entry not found' });
      if (cur.status !== 'cleared_pending' || cur.cleared_by !== gate.user?.id) {
        return res.status(403).json({ error: 'You can only withdraw your own pending clearance request' });
      }
    }
    const before = (await sql`SELECT r.*, p.name AS project_name FROM fin_project_revenue r LEFT JOIN projects p ON p.id=r.project_id WHERE r.project_id=${project_id} AND r.month=${mY} AND r.year=${yY}`)[0] as any;
    const updated = (await sql`
      UPDATE fin_project_revenue SET
        status='pending',
        amount_received=NULL, received_inr=NULL, received_fx_rate=NULL,
        cleared_at=NULL, cleared_by=NULL, cleared_by_name=NULL, clearance_note=NULL
      WHERE project_id=${project_id} AND month=${mY} AND year=${yY}
      RETURNING *`)[0];
    if (!updated) return res.status(404).json({ error: 'Billing entry not found' });
    logRevenueAudit('reopened', before, updated, gate.user, before?.project_name);
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// GET /api/finance/revenue/audit — list audit entries. Admin only —
// exposes per-project clearance history. Same shape as the invoice
// audit endpoint for symmetry on the client.
app.get('/api/finance/revenue/audit', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;
    const project_id = (req.query.project_id as string) || null;
    const actor_id   = (req.query.actor_id   as string) || null;
    const action     = (req.query.action     as string) || null;
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await sql`
      SELECT *
      FROM fin_revenue_audit
      WHERE (${month}::int IS NULL OR month=${month})
        AND (${year}::int  IS NULL OR year=${year})
        AND (${project_id}::text IS NULL OR project_id=${project_id})
        AND (${actor_id}::text   IS NULL OR actor_id=${actor_id})
        AND (${action}::text     IS NULL OR action=${action})
      ORDER BY changed_at DESC
      LIMIT ${limit}`;
    res.json(rows);
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

// GET /api/finance/project-expenses/template?month=&year= — returns a CSV
// template seeded with every active project for the given period. Admin
// fills the amount + description + (optional) vendor / category columns
// and uploads back via POST /bulk. Leaving a row's amount blank just
// means "no expense for this project this month" and is silently
// skipped on import.
app.get('/api/finance/project-expenses/template', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const month = Number(req.query.month) || (new Date().getMonth() + 1);
    const year  = Number(req.query.year)  || (new Date().getFullYear());
    const projects = await sql`
      SELECT id, name, client_name FROM projects
      WHERE status='active'
      ORDER BY name` as any[];
    const csvField = (v: any): string => {
      const s = (v ?? '').toString();
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['project_id','project_name','client_name','month','year','vendor','description','amount','category'].join(',');
    const lines = [header];
    for (const p of projects) {
      lines.push([
        csvField(p.id), csvField(p.name), csvField(p.client_name || ''),
        month, year, '', '', '', 'outsource',
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="project-expenses-${year}-${String(month).padStart(2,'0')}.csv"`);
    res.send(lines.join('\n'));
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// POST /api/finance/project-expenses/bulk — body: { rows: [...] }. Each
// row gets validated and inserted independently — bad rows don't block
// the rest. Response: { inserted, skipped, errors: [up to 20] }.
//   - Rows with empty / zero amount are silently skipped (intentional
//     "no expense this month" blanks from the template).
//   - Rows with unknown project_id or missing description go to errors.
//   - month/year fall back to today's period when blank.
//   - category defaults to 'outsource' to match the single-row POST.
app.post('/api/finance/project-expenses/bulk', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ error: 'rows array required' });
    const validProjects = new Set<string>(
      ((await sql`SELECT id FROM projects`) as any[]).map(r => r.id)
    );
    const defM = new Date().getMonth() + 1;
    const defY = new Date().getFullYear();
    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const lineNo = i + 2; // header is line 1
      const project_id = String(r.project_id ?? '').trim();
      if (!project_id) { skipped++; continue; }
      if (!validProjects.has(project_id)) {
        skipped++;
        if (errors.length < 20) errors.push(`Row ${lineNo}: unknown project_id "${project_id}"`);
        continue;
      }
      const amountRaw = r.amount;
      if (amountRaw === '' || amountRaw == null) { skipped++; continue; }
      const amount = Number(amountRaw);
      if (!isFinite(amount) || amount <= 0) {
        skipped++;
        if (errors.length < 20) errors.push(`Row ${lineNo}: invalid amount "${amountRaw}"`);
        continue;
      }
      const description = String(r.description ?? '').trim();
      if (!description) {
        skipped++;
        if (errors.length < 20) errors.push(`Row ${lineNo}: description required`);
        continue;
      }
      const month = Number(r.month) || defM;
      const year = Number(r.year) || defY;
      const vendor = (r.vendor ?? '').toString().trim() || null;
      const category = (r.category ?? '').toString().trim() || 'outsource';
      try {
        await sql`
          INSERT INTO fin_project_expenses (project_id, month, year, vendor, description, amount, category, created_by, created_by_role)
          VALUES (${project_id}, ${month}, ${year}, ${vendor}, ${description}, ${amount}, ${category},
                  ${gate.user?.name ?? null}, ${gate.user?.role ?? null})`;
        inserted++;
      } catch (e: any) {
        skipped++;
        if (errors.length < 20) errors.push(`Row ${lineNo}: ${e?.message || 'insert failed'}`);
      }
    }
    res.json({ inserted, skipped, errors });
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

// One-stop audit writer for finance invoices. `before` and `after` are
// the invoice rows (either may be null — null `before` on create, null
// `after` on delete). Wrapped so a failed audit insert never blocks the
// actual mutation; the GET endpoint will simply not see the entry.
async function logInvoiceAudit(
  action: 'created' | 'edited' | 'cleared' | 'reopened' | 'deleted' | 'clear_requested' | 'clear_rejected',
  before: any | null,
  after: any | null,
  actor: { id?: string | null; name?: string | null; role?: string | null } | null,
  projectName?: string | null,
) {
  try {
    const ref = after ?? before;
    if (!ref) return;
    await sql`
      INSERT INTO fin_invoice_audit (
        invoice_id, action,
        invoice_number, invoice_date,
        project_id, project_name, month, year, currency,
        amount_invoiced_before, amount_invoiced_after,
        amount_received_before, amount_received_after,
        status_before, status_after,
        notes_before, notes_after,
        actor_id, actor_name, actor_role
      ) VALUES (
        ${ref.id ?? null}, ${action},
        ${ref.invoice_number ?? null}, ${ref.invoice_date ?? null},
        ${ref.project_id ?? null}, ${projectName ?? ref.project_name ?? null},
        ${ref.month ?? null}, ${ref.year ?? null}, ${ref.currency ?? null},
        ${before?.amount_invoiced ?? null}, ${after?.amount_invoiced ?? null},
        ${before?.amount_received ?? null}, ${after?.amount_received ?? null},
        ${before?.status ?? null}, ${after?.status ?? null},
        ${before?.notes ?? null}, ${after?.notes ?? null},
        ${actor?.id ?? null}, ${actor?.name ?? null}, ${actor?.role ?? null}
      )`;
  } catch {/* audit write must never fail the parent request */}
}

// Audit writer for Billing setup (fin_project_revenue). `before` and
// `after` are the revenue rows; either can be null on create / delete-
// style transitions but in practice both are populated. The invoiced
// amount is computed from billing_type + (fixed_amount | hourly_rate *
// billable_hours) since that's the user-facing native-currency total.
async function logRevenueAudit(
  action: 'saved' | 'clear_requested' | 'cleared' | 'clear_rejected' | 'reopened',
  before: any | null,
  after: any | null,
  actor: { id?: string | null; name?: string | null; role?: string | null } | null,
  projectName?: string | null,
) {
  try {
    const ref = after ?? before;
    if (!ref) return;
    const computeNative = (r: any) => {
      if (!r) return null;
      return r.billing_type === 'hourly'
        ? Number(r.hourly_rate || 0) * Number(r.billable_hours || 0)
        : Number(r.fixed_amount || 0);
    };
    await sql`
      INSERT INTO fin_revenue_audit (
        project_id, project_name, month, year, action, currency,
        billing_type_before, billing_type_after,
        amount_invoiced_before, amount_invoiced_after,
        amount_received_before, amount_received_after,
        status_before, status_after,
        notes_before, notes_after,
        actor_id, actor_name, actor_role
      ) VALUES (
        ${ref.project_id}, ${projectName ?? ref.project_name ?? null},
        ${ref.month}, ${ref.year}, ${action}, ${ref.currency ?? null},
        ${before?.billing_type ?? null}, ${after?.billing_type ?? null},
        ${computeNative(before)}, ${computeNative(after)},
        ${before?.amount_received ?? null}, ${after?.amount_received ?? null},
        ${before?.status ?? null}, ${after?.status ?? null},
        ${before?.clearance_note ?? null}, ${after?.clearance_note ?? null},
        ${actor?.id ?? null}, ${actor?.name ?? null}, ${actor?.role ?? null}
      )`;
  } catch {/* audit write must never block the parent request */}
}

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
    logInvoiceAudit('created', null, inv, gate.user, proj[0].name);
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
    const updated = rows[0];
    logInvoiceAudit('edited', inv, updated, gate.user);
    if (wasCleared && inv.created_by) {
      notifyUser(inv.created_by, 'invoice_adjusted', 'Invoice Adjusted',
        `Admin updated cleared invoice${inv.invoice_number ? ` ${inv.invoice_number}` : ''}.`).catch(()=>{});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.patch('/api/finance/invoices/:id/clear', async (req, res) => {
  await runStartupMigrations();
  // Coordinator can now propose a clearance — but only an admin's call
  // flips the invoice to 'cleared' outright. A coordinator's call lands
  // it in 'cleared_pending', and admin gets a notification to either
  // approve (→ cleared) or reject (→ back to pending) the request.
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const id = Number(req.params.id);
    const existing = (await sql`SELECT i.*, p.name AS project_name FROM fin_project_invoices i LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = existing[0];
    const isAdmin = gate.user?.role === 'admin';
    // Allow re-submitting clearance only when status is 'pending' (fresh)
    // or 'cleared_pending' (coord adjusting before admin reviews). Admin
    // calling on 'cleared' is a no-op handled by edit; don't double-flip.
    if (inv.status === 'cleared' && isAdmin) {
      return res.status(400).json({ error: 'Invoice already cleared — edit it instead' });
    }
    if (!isAdmin && inv.status === 'cleared_pending' && inv.cleared_by !== gate.user?.id) {
      return res.status(403).json({ error: 'Only the requester or an admin can update this clearance' });
    }
    const { amount_received, cleared_date, notes } = req.body;
    const received = amount_received != null ? Number(amount_received) : Number(inv.amount_invoiced);
    if (received < 0) return res.status(400).json({ error: 'amount_received cannot be negative' });
    const actorName = gate.user?.name ?? null;
    const actorId = gate.user?.id ?? null;
    const newStatus = isAdmin ? 'cleared' : 'cleared_pending';
    const rows = await sql`
      UPDATE fin_project_invoices SET
        amount_received=${received},
        status=${newStatus},
        cleared_date=${cleared_date || new Date().toISOString().slice(0, 10)},
        cleared_by=${actorId},
        cleared_by_name=${actorName},
        notes=COALESCE(${notes?.trim() || null}, notes),
        updated_at=NOW()
      WHERE id=${id}
      RETURNING *`;
    const updated = rows[0];
    logInvoiceAudit(isAdmin ? 'cleared' : 'clear_requested', inv, updated, gate.user, inv.project_name);
    if (isAdmin) {
      // Final approval — ping the coordinator who raised the invoice.
      if (inv.created_by) {
        const variance = received - Number(inv.amount_invoiced);
        const varianceMsg = variance === 0 ? 'paid in full' : variance < 0 ? `short by ${fmtMoney(Math.abs(variance))}` : `extra ${fmtMoney(variance)}`;
        notifyUser(inv.created_by, 'invoice_cleared', 'Invoice Cleared ✅',
          `${inv.project_name} · ${fmtMoney(received)} received (${varianceMsg}).`).catch(()=>{});
      }
    } else {
      // Coordinator requested clearance — ping admins for final approval.
      notifyAdminsAndHR('invoice_clear_requested',
        'Clearance request awaiting your approval',
        `${actorName ?? 'A coordinator'} marked ${inv.project_name}${inv.invoice_number ? ` (${inv.invoice_number})` : ''} as cleared for ${fmtMoney(received)}. Open Finance to approve.`
      ).catch(()=>{});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// PATCH /api/finance/invoices/:id/approve-clearance — admin-only. Promotes
// a coord-submitted cleared_pending to cleared. Notifies the coord who
// raised the original clearance request.
app.patch('/api/finance/invoices/:id/approve-clearance', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const existing = (await sql`SELECT i.*, p.name AS project_name FROM fin_project_invoices i LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = existing[0];
    if (inv.status !== 'cleared_pending') {
      return res.status(400).json({ error: `Invoice is ${inv.status}, not awaiting clearance approval` });
    }
    const adminUser = (await sql`SELECT id, name FROM app_users WHERE id=${(req.headers['x-user-id'] as string) || ''}`) as any[];
    const rows = await sql`
      UPDATE fin_project_invoices SET status='cleared', updated_at=NOW() WHERE id=${id} RETURNING *`;
    const updated = rows[0];
    logInvoiceAudit('cleared', inv, updated, { id: adminUser[0]?.id ?? null, name: adminUser[0]?.name ?? null, role: 'admin' }, inv.project_name);
    // Tell the coordinator the request was approved.
    if (inv.cleared_by && inv.cleared_by !== adminUser[0]?.id) {
      notifyUser(inv.cleared_by, 'invoice_cleared',
        'Clearance approved ✅',
        `${inv.project_name}${inv.invoice_number ? ` (${inv.invoice_number})` : ''}: ${fmtMoney(Number(inv.amount_received))} received — confirmed.`).catch(()=>{});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// PATCH /api/finance/invoices/:id/reject-clearance — admin-only. Bounces
// a coord-submitted clearance back to pending. Body { rejection_reason }.
// Notifies the coord with the reason so they can fix and resubmit.
app.patch('/api/finance/invoices/:id/reject-clearance', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const { rejection_reason } = req.body ?? {};
    if (!rejection_reason?.trim()) return res.status(400).json({ error: 'rejection_reason is required' });
    const existing = (await sql`SELECT i.*, p.name AS project_name FROM fin_project_invoices i LEFT JOIN projects p ON p.id=i.project_id WHERE i.id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = existing[0];
    if (inv.status !== 'cleared_pending') {
      return res.status(400).json({ error: `Invoice is ${inv.status}, not awaiting clearance approval` });
    }
    const adminUser = (await sql`SELECT id, name FROM app_users WHERE id=${(req.headers['x-user-id'] as string) || ''}`) as any[];
    const requester = inv.cleared_by;
    const rows = await sql`
      UPDATE fin_project_invoices SET
        status='pending',
        amount_received=NULL,
        cleared_date=NULL,
        cleared_by=NULL,
        cleared_by_name=NULL,
        updated_at=NOW()
      WHERE id=${id}
      RETURNING *`;
    const updated = rows[0];
    logInvoiceAudit('clear_rejected', inv, updated, { id: adminUser[0]?.id ?? null, name: adminUser[0]?.name ?? null, role: 'admin' }, inv.project_name);
    if (requester) {
      notifyUser(requester, 'invoice_clear_rejected',
        'Clearance request needs revision',
        `Admin rejected the clearance on ${inv.project_name}${inv.invoice_number ? ` (${inv.invoice_number})` : ''}: ${rejection_reason.trim().slice(0, 200)}`
      ).catch(()=>{});
    }
    res.json(updated);
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

app.patch('/api/finance/invoices/:id/reopen', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(req.params.id);
    const existing = (await sql`SELECT * FROM fin_project_invoices WHERE id=${id}`) as any[];
    if (!existing.length) return res.status(404).json({ error: 'Invoice not found' });
    const inv = existing[0];
    const rows = await sql`
      UPDATE fin_project_invoices SET
        status='pending', amount_received=NULL, cleared_date=NULL,
        cleared_by=NULL, cleared_by_name=NULL, updated_at=NOW()
      WHERE id=${id}
      RETURNING *`;
    const updated = rows[0];
    const uid = (req.headers['x-user-id'] as string) || '';
    const actor = uid ? ((await sql`SELECT id, name, role FROM app_users WHERE id=${uid}`)[0] as any) : null;
    logInvoiceAudit('reopened', inv, updated, actor);
    if (inv.created_by) {
      notifyUser(inv.created_by, 'invoice_reopened', 'Invoice Reopened',
        `Admin reopened invoice${inv.invoice_number ? ` ${inv.invoice_number}` : ''} — marked pending again.`).catch(()=>{});
    }
    res.json(updated);
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
    logInvoiceAudit('deleted', inv, null, gate.user);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// POST /api/finance/invoices/copy-month — clone the source-month
// invoices into the target month as fresh PENDING rows.
//
// Semantics:
//   • For each project that had at least one invoice in (from_month,
//     from_year) AND has no existing invoice in (to_month, to_year),
//     pick that project's most recent invoice from the source month
//     and copy its template (amount_invoiced, currency, fx_rate,
//     invoice_number, notes) into the target month as a NEW row with:
//       status='pending', amount_received=NULL, cleared_*=NULL,
//       created_by=<actor>, created_by_name/role=<actor>,
//       invoice_date = target month first day (admin can adjust).
//   • Projects that already have at least one target-month invoice
//     are skipped — never duplicate. (Multiple invoices per project
//     per month is supported, but copy-month picks one template per
//     project so admin doesn't drown in dupes.)
//
// Returns { copied, skipped } so the UI can toast a useful summary.
app.post('/api/finance/invoices/copy-month', async (req, res) => {
  await runStartupMigrations();
  const gate = await requireAdminOrCoord(req, res);
  if (!gate.ok) return;
  try {
    const { from_month, from_year, to_month, to_year } = req.body ?? {};
    if (!from_month || !from_year || !to_month || !to_year) {
      return res.status(400).json({ error: 'from/to month & year are required' });
    }
    const fm = Number(from_month), fy = Number(from_year);
    const tm = Number(to_month),   ty = Number(to_year);

    // 1. Latest source-month invoice PER project. DISTINCT ON keeps
    //    the most recent created_at per project_id.
    const sources = (await sql`
      SELECT DISTINCT ON (project_id)
        project_id, invoice_number, amount_invoiced, currency, fx_rate,
        amount_invoiced_inr, notes
      FROM fin_project_invoices
      WHERE month=${fm} AND year=${fy}
        AND status <> 'cancelled'
      ORDER BY project_id, created_at DESC`) as any[];
    if (sources.length === 0) {
      return res.json({ copied: 0, skipped: 0, message: `No invoices to copy from ${fm}/${fy}` });
    }
    // 2. Projects already invoiced in the target month — skip these.
    const targetExisting = (await sql`
      SELECT DISTINCT project_id FROM fin_project_invoices
      WHERE month=${tm} AND year=${ty}`) as any[];
    const alreadyInvoiced = new Set<string>(targetExisting.map(r => r.project_id));

    const targetFirstDay = `${ty}-${String(tm).padStart(2, '0')}-01`;
    let copied = 0;
    let skipped = 0;
    for (const s of sources) {
      if (alreadyInvoiced.has(s.project_id)) { skipped++; continue; }
      await sql`
        INSERT INTO fin_project_invoices
          (project_id, month, year, invoice_number, invoice_date,
           amount_invoiced, currency, fx_rate, amount_invoiced_inr,
           notes, status, created_by, created_by_name, created_by_role)
        VALUES (${s.project_id}, ${tm}, ${ty}, ${s.invoice_number ?? null},
                ${targetFirstDay}::date,
                ${Number(s.amount_invoiced)}, ${s.currency ?? 'INR'},
                ${s.fx_rate ?? 1}, ${s.amount_invoiced_inr ?? Number(s.amount_invoiced)},
                ${s.notes ?? null}, 'pending',
                ${gate.user?.id ?? null}, ${gate.user?.name ?? null}, ${gate.user?.role ?? null})`;
      copied++;
    }
    res.json({ copied, skipped, total: sources.length });
  } catch (err: any) { res.status(500).json({ error: err.message || 'Server error' }); }
});

// GET /api/finance/invoices/audit — list audit entries. Admin only since
// the log exposes who-did-what on revenue rows.
app.get('/api/finance/invoices/audit', async (req, res) => {
  await runStartupMigrations();
  if (!(await requireAdmin(req, res))) return;
  try {
    const month = req.query.month ? Number(req.query.month) : null;
    const year  = req.query.year  ? Number(req.query.year)  : null;
    const project_id = (req.query.project_id as string) || null;
    const actor_id  = (req.query.actor_id  as string) || null;
    const action   = (req.query.action  as string) || null;
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const rows = await sql`
      SELECT *
      FROM fin_invoice_audit
      WHERE (${month}::int IS NULL OR month=${month})
        AND (${year}::int  IS NULL OR year=${year})
        AND (${project_id}::text IS NULL OR project_id=${project_id})
        AND (${actor_id}::text   IS NULL OR actor_id=${actor_id})
        AND (${action}::text     IS NULL OR action=${action})
      ORDER BY changed_at DESC
      LIMIT ${limit}`;
    res.json(rows);
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

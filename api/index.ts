import express from 'express';
import cors from 'cors';
import { neon } from '@neondatabase/serverless';

// Lazy Neon client — initialised on first query so env vars are ready
let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return (_sql = neon(url.replace(/[?&]channel_binding=[^&]*/g, '').replace(/[?&]$/, '')));
}
const sql = ((...a: any[]) => (getSql() as any)(...a)) as ReturnType<typeof neon>;

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost')) {
      cb(null, true);
    } else {
      cb(new Error('Not allowed by CORS'));
    }
  },
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

async function notifyEmployeeUser(employeeDbId: string, type: string, title: string, body?: string) {
  try {
    const users = await sql`SELECT u.id FROM app_users u JOIN employees e ON e.employee_id = u.employee_id_ref WHERE e.id = ${employeeDbId}`;
    await Promise.all((users as any[]).map((u: any) => notifyUser(u.id, type, title, body)));
  } catch { /* non-fatal */ }
}

// ── Startup migrations (idempotent — safe to run on every cold start) ────
let _migrated = false;
async function runStartupMigrations() {
  if (_migrated) return;
  _migrated = true;
  try {
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end_date DATE`;
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id TEXT`;
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`;
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS biometric_sync_id TEXT`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS full_day INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS short_leave INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_credited_month INTEGER`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS last_credited_year INTEGER`;
    await sql`ALTER TABLE leave_balances ADD COLUMN IF NOT EXISTS probation_short_used INTEGER NOT NULL DEFAULT 0`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS manager_rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioner_name VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS hr_actioned_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(200)`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`;
    await sql`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT`;
  } catch { /* non-fatal — columns may already exist */ }
}

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', async (_, res) => {
  await runStartupMigrations();
  res.json({ status: 'ok' });
});

// ── Auth ──────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const rows = await sql`SELECT * FROM app_users WHERE LOWER(email) = LOWER(${email}) AND password = ${password} LIMIT 1`;
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = rows[0] as any;
    if (!user.active) return res.status(403).json({ error: 'Your account has been deactivated. Contact HR.' });
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
    const { name, email, phone, department, designation, location, manager, reporting_manager_id, status, salary, ctc, biometric_id, shift, next_appraisal_month, next_appraisal_year } = req.body;
    const rows = await sql`
      UPDATE employees SET name=${name}, email=${email}, phone=${phone}, department=${department},
        designation=${designation}, location=${location}, manager=${manager ?? null},
        reporting_manager_id=${reporting_manager_id ?? null},
        status=${status}, salary=${salary}, ctc=${ctc},
        biometric_id=${biometric_id ?? null}, shift=${shift ?? 'day'},
        next_appraisal_month=${next_appraisal_month ?? null}, next_appraisal_year=${next_appraisal_year ?? null}
      WHERE id=${req.params.id} RETURNING *`;
    res.json(rows[0]);
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
    } else {
      rows = await sql`SELECT * FROM attendance_records ORDER BY date DESC, employee_id`;
    }
    res.json((rows as any[]).map(normDateV));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/attendance/clock-in', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toTimeString().slice(0, 5);
    const empRow = await sql`SELECT shift FROM employees WHERE id=${employee_id}` as any[];
    const empShift = empRow[0]?.shift ?? 'day';
    const status = isLateV(time, empShift) ? 'late' : 'present';
    const rows = await sql`
      INSERT INTO attendance_records (employee_id, date, check_in, status, total_hours)
      VALUES (${employee_id}, ${today}, ${time}, ${status}, 0)
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in=${time}, status=${status}
      RETURNING *`;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
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
    const today = new Date().toISOString().split('T')[0];
    const time = new Date().toTimeString().slice(0, 5);
    const rows = await sql`
      UPDATE attendance_records SET check_out=${time},
        total_hours=ROUND(EXTRACT(EPOCH FROM (${time}::time - check_in::time))/3600, 1)
      WHERE employee_id=${employee_id} AND date=${today} RETURNING *`;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Biometric sync — eTimeOffice (Vercel mirror) ──────────────────────────

const ET_STATUS_MAP: Record<string, string> = {
  'P':'present','A':'absent','WO':'weekend','H':'holiday','LA':'late','PL':'late',
  'HD':'half-day','L':'on_leave','LV':'on_leave','CL':'on_leave','SL':'on_leave',
  'EL':'on_leave','ML':'on_leave','OD':'present','WFH':'present','CO':'present',
};

const SHIFT_CFG: Record<string, { lateAfter: string }> = {
  day:   { lateAfter: '09:30' },
  night: { lateAfter: '18:45' },
};
function isLateV(inTime: string, shift: string): boolean {
  const [lh,lm] = (SHIFT_CFG[shift] ?? SHIFT_CFG.day).lateAfter.split(':').map(Number);
  const [ch,cm] = inTime.split(':').map(Number);
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
  if (!apiUrl) throw new Error('BIOMETRIC_API_URL is not configured');
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
    const key = e.biometric_id ? String(e.biometric_id).trim() : String(e.employee_id).trim();
    empMap.set(key, e.id);
    shiftMap.set(e.id, e.shift ?? 'day');
  }
  const syncId = crypto.randomUUID();
  let updated = 0, created = 0;

  for (const rec of records) {
    const empCode = String(rec.Empcode ?? '').trim();
    if (!empCode) continue;
    const iid = empMap.get(empCode);
    if (!iid) continue;
    // Parse DateString DD/MM/YYYY → YYYY-MM-DD
    const rawDs = String(rec.DateString ?? '').trim();
    let recDate = today;
    if (rawDs.includes('/')) { const [rdd,rmm,ry]=rawDs.split('/'); recDate=`${ry}-${rmm}-${rdd}`; }
    const inTime  = parseEtTimeV(rec.INTime);
    const outTime = parseEtTimeV(rec.OUTTime);
    const empShift = shiftMap.get(iid) ?? 'day';
    const status  = inTime
      ? (isLateV(inTime, empShift) ? 'late' : 'present')
      : (ET_STATUS_MAP[(rec.Status??'A').toUpperCase()] ?? 'absent');
    if ((status === 'weekend' || status === 'holiday') && !inTime) continue;
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

app.post('/api/attendance/biometric-sync/rollback', async (_req, res) => {
  try {
    const logs = await sql`SELECT * FROM attendance_sync_log WHERE is_rolled_back=FALSE AND status='success' ORDER BY synced_at DESC LIMIT 1` as any[];
    if (!logs.length) return res.status(404).json({ error: 'No sync to rollback' });
    const { sync_id } = logs[0];
    const snaps = await sql`SELECT * FROM attendance_sync_snapshot WHERE sync_id=${sync_id}` as any[];
    for (const s of snaps) {
      if (!s.had_record) { await sql`DELETE FROM attendance_records WHERE employee_id=${s.employee_id} AND date=${s.date} AND biometric_sync_id=${sync_id}`; }
      else { await sql`UPDATE attendance_records SET check_in=${s.check_in_before??null},check_out=${s.check_out_before??null},status=${s.status_before},total_hours=${s.total_hours_before??0},source='manual',biometric_sync_id=NULL WHERE employee_id=${s.employee_id} AND date=${s.date}`; }
    }
    await sql`UPDATE attendance_sync_log SET is_rolled_back=TRUE,rolled_back_at=NOW(),status='rolled_back' WHERE sync_id=${sync_id}`;
    res.json({ success: true, sync_id, records_restored: snaps.length });
  } catch (err: any) { res.status(500).json({ error: err.message ?? 'Rollback failed' }); }
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
  const balRows = await sql`SELECT * FROM leave_balances WHERE employee_id=${employeeId}`;
  if (!balRows.length) return;
  const bal = balRows[0] as any;
  if (bal.last_credited_month === cm && bal.last_credited_year === cy) return;
  if (isOnProbation(joinDate)) {
    await sql`UPDATE leave_balances SET last_credited_month=${cm}, last_credited_year=${cy} WHERE employee_id=${employeeId}`;
    return;
  }
  const lastM = bal.last_credited_month ?? cm;
  const lastY = bal.last_credited_year ?? cy;
  const months = Math.max(1, (cy - lastY) * 12 + (cm - lastM));
  await sql`UPDATE leave_balances SET full_day=COALESCE(full_day,0)+${months}, short_leave=2, last_credited_month=${cm}, last_credited_year=${cy} WHERE employee_id=${employeeId}`;
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
    await sql`
      DELETE FROM attendance_records
      WHERE employee_id=${employeeId} AND date::date=${current}::date
        AND status = ANY(${leaveStatuses})
    `.catch(() => {});
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
    const empRows = await sql`SELECT join_date, probation_end_date, reporting_manager_id FROM employees WHERE id=${employee_id}`.catch(() => []);
    const emp = (empRows as any[])[0] ?? {};
    const onProbation = isOnProbation(emp.join_date ?? null, emp.probation_end_date ?? null);
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
      notifyEmployeeUser(emp.reporting_manager_id, 'leave_applied', 'New Leave Request', `${employee_name} applied for ${type.replace('_',' ')} leave (${from} – ${to})`);
    } else {
      notifyAdminsAndHR('leave_applied', 'New Leave Request', `${employee_name} applied for ${type.replace('_',' ')} leave (${from} – ${to})`);
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

app.post('/api/performance/monthly', async (req, res) => {
  try {
    const { employee_id, reviewer_id, reviewer_name, month, year, productivity, quality, teamwork, attendance_score, initiative, client_satisfaction, ai_usage, overall_score, comments, parameter_notes } = req.body;
    const paramNotesJson = JSON.stringify(parameter_notes ?? {});
    // Ensure ai_usage and parameter_notes columns exist (idempotent)
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS ai_usage INTEGER DEFAULT 75`.catch(() => {});
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS parameter_notes JSONB DEFAULT '{}'`.catch(() => {});
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
    const rows = await sql`
      INSERT INTO app_users (id, employee_id_ref, name, email, password, role, department, designation, avatar, active)
      VALUES (${id}, ${employee_id_ref ?? null}, ${name}, ${email}, ${password}, ${role}, ${department}, ${designation}, ${av}, true)
      RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, email, password, role, department, designation, avatar, active } = req.body;
    const rows = await sql`
      UPDATE app_users SET name=${name}, email=${email}, password=${password}, role=${role},
        department=${department}, designation=${designation}, avatar=${avatar}, active=${active}
      WHERE id=${req.params.id}
      RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at`;
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
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

export default app;

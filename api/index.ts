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

// ── Health ────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

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
app.get('/api/employees', async (_req, res) => {
  try {
    res.json(await sql`SELECT * FROM employees ORDER BY name`);
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
    const { id, name, email, phone, department, designation, employee_id, join_date, location, manager, status, avatar, salary, ctc } = req.body;
    const rows = await sql`
      INSERT INTO employees (id, name, email, phone, department, designation, employee_id, join_date, location, manager, status, avatar, salary, ctc)
      VALUES (${id}, ${name}, ${email}, ${phone}, ${department}, ${designation}, ${employee_id}, ${join_date}, ${location}, ${manager}, ${status ?? 'active'}, ${avatar}, ${salary}, ${ctc})
      RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'Employee ID or email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/employees/:id', async (req, res) => {
  try {
    const { name, email, phone, department, designation, location, manager, status, salary, ctc } = req.body;
    const rows = await sql`
      UPDATE employees SET name=${name}, email=${email}, phone=${phone}, department=${department},
        designation=${designation}, location=${location}, manager=${manager}, status=${status}, salary=${salary}, ctc=${ctc}
      WHERE id=${req.params.id} RETURNING *`;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

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
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/attendance/clock-in', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toTimeString().slice(0, 5);
    const status = now.getHours() >= 10 ? 'late' : 'present';
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

// ── Leave ─────────────────────────────────────────────────────────────────
app.get('/api/leave/requests', async (req, res) => {
  try {
    const { employee_id, status } = req.query as any;
    let rows;
    if (employee_id) {
      rows = await sql`SELECT * FROM leave_requests WHERE employee_id=${employee_id} ORDER BY applied_on DESC`;
    } else if (status) {
      rows = await sql`SELECT * FROM leave_requests WHERE status=${status} ORDER BY applied_on DESC`;
    } else {
      rows = await sql`SELECT * FROM leave_requests ORDER BY applied_on DESC`;
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/leave/requests', async (req, res) => {
  try {
    const { employee_id, employee_name, type, from_date, to_date, days, reason } = req.body;
    const id = `l_${Date.now()}`;
    const rows = await sql`
      INSERT INTO leave_requests (id, employee_id, employee_name, type, from_date, to_date, days, reason, status)
      VALUES (${id}, ${employee_id}, ${employee_name}, ${type}, ${from_date}, ${to_date}, ${days}, ${reason}, 'pending')
      RETURNING *`;
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/leave/requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const rows = await sql`UPDATE leave_requests SET status=${status} WHERE id=${req.params.id} RETURNING *`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/leave/balances/:employee_id', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM leave_balances WHERE employee_id=${req.params.employee_id}`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
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

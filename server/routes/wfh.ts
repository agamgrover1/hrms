import { Router } from 'express';
import { sql } from '../db';
import { notifyAdminsAndHR, notifyEmployeeUser, notifyManagerOfEmployee } from '../lib/notify';

const router = Router();

// ── Boot-time migration ───────────────────────────────────────────────────────
;(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS wfh_requests (
        id                      TEXT PRIMARY KEY,
        employee_id             TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name           TEXT,
        date                    DATE NOT NULL,
        type                    TEXT NOT NULL DEFAULT 'full_day',  -- full_day | half_day
        reason                  TEXT,
        status                  TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | cancelled
        manager_status          TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
        manager_id              TEXT,
        manager_name            TEXT,
        manager_approved_at     TIMESTAMPTZ,
        manager_rejection_reason TEXT,
        hr_actioner_name        TEXT,
        hr_actioned_at          TIMESTAMPTZ,
        rejection_reason        TEXT,
        cancelled_by            TEXT,
        cancelled_at            TIMESTAMPTZ,
        cancellation_reason     TEXT,
        applied_on              TIMESTAMPTZ DEFAULT NOW(),
        created_at              TIMESTAMPTZ DEFAULT NOW()
      )
    `;
  } catch { /* ignore */ }
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
const WFH_ATT_STATUS: Record<string, string> = { full_day: 'wfh', half_day: 'wfh_half' };
const IST_MS = 5.5 * 60 * 60 * 1000;

function toDateStr(d: any): string {
  // Handles Neon returning DATE as Date object, ISO string "T18:30:00Z", or plain "YYYY-MM-DD"
  const s = d instanceof Date ? d.toISOString() : String(d);
  if (!s.includes('T')) return s.slice(0, 10);
  return new Date(new Date(s).getTime() + IST_MS).toISOString().slice(0, 10);
}

async function markWfhAttendance(employeeId: string, date: any, type: string) {
  const attStatus = WFH_ATT_STATUS[type] ?? 'wfh';
  const dateStr = toDateStr(date);
  await sql`
    INSERT INTO attendance_records (employee_id, date, status, total_hours, source)
    VALUES (${employeeId}, ${dateStr}, ${attStatus}, 0, 'wfh')
    ON CONFLICT (employee_id, date) DO UPDATE SET status = ${attStatus}, source = 'wfh'
  `;
}

async function clearWfhAttendance(employeeId: string, date: any) {
  const dateStr = toDateStr(date);
  await sql`
    DELETE FROM attendance_records
    WHERE employee_id = ${employeeId} AND date::date = ${dateStr}::date AND source = 'wfh'
  `.catch(() => {});
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /wfh/requests
router.get('/requests', async (req, res) => {
  try {
    const { employee_id, status, reporting_manager_id } = req.query;
    let rows;
    if (reporting_manager_id) {
      rows = await sql`
        SELECT wr.* FROM wfh_requests wr
        JOIN employees e ON e.id = wr.employee_id
        WHERE e.reporting_manager_id = ${reporting_manager_id as string}
          AND wr.manager_status = 'pending' AND wr.status = 'pending'
        ORDER BY wr.applied_on DESC
      `;
    } else if (employee_id) {
      rows = await sql`SELECT * FROM wfh_requests WHERE employee_id = ${employee_id as string} ORDER BY applied_on DESC`;
    } else if (status) {
      rows = await sql`SELECT * FROM wfh_requests WHERE status = ${status as string} ORDER BY applied_on DESC`;
    } else {
      rows = await sql`SELECT * FROM wfh_requests ORDER BY applied_on DESC`;
    }
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /wfh/requests — apply
router.post('/requests', async (req, res) => {
  try {
    const { employee_id, employee_name, date, type, reason } = req.body;
    if (!employee_id || !date || !type) return res.status(400).json({ error: 'employee_id, date, type are required' });
    const id = `wfh_${Date.now()}`;
    const rows = await sql`
      INSERT INTO wfh_requests (id, employee_id, employee_name, date, type, reason)
      VALUES (${id}, ${employee_id}, ${employee_name ?? null}, ${date}, ${type}, ${reason ?? null})
      RETURNING *
    `;
    const req2 = rows[0] as any;
    const dateLabel = new Date(date + 'T12:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    notifyManagerOfEmployee(employee_id, 'leave_applied', 'WFH Request',
      `${employee_name ?? 'Employee'} has applied for ${type === 'half_day' ? 'Half Day' : 'Full Day'} Work From Home on ${dateLabel}.`).catch(() => {});
    res.status(201).json(req2);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// PATCH /wfh/requests/:id/manager-approve
router.patch('/requests/:id/manager-approve', async (req, res) => {
  try {
    const { status, manager_id, manager_name, rejection_reason } = req.body;
    if (status === 'rejected') {
      const rows = await sql`
        UPDATE wfh_requests SET manager_status='rejected', manager_id=${manager_id ?? null},
          manager_name=${manager_name ?? null}, manager_approved_at=NOW(),
          manager_rejection_reason=${rejection_reason ?? null}, status='rejected'
        WHERE id=${req.params.id} RETURNING *
      `;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const w = rows[0] as any;
      notifyEmployeeUser(w.employee_id, 'leave_rejected', 'WFH Request Rejected by Manager',
        `Your Work From Home request was rejected by your manager.`).catch(() => {});
      return res.json(w);
    }
    const rows = await sql`
      UPDATE wfh_requests SET manager_status='approved', manager_id=${manager_id ?? null},
        manager_name=${manager_name ?? null}, manager_approved_at=NOW()
      WHERE id=${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const w = rows[0] as any;
    notifyAdminsAndHR('leave_applied', 'WFH Needs HR Approval',
      `${w.employee_name}'s ${w.type === 'half_day' ? 'Half Day' : 'Full Day'} WFH request approved by manager — awaiting final approval.`).catch(() => {});
    res.json(w);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// PATCH /wfh/requests/:id — HR final
router.patch('/requests/:id', async (req, res) => {
  try {
    const { status, actioner_name, rejection_reason } = req.body;
    const rows = await sql`
      UPDATE wfh_requests SET status=${status},
        hr_actioner_name=${actioner_name ?? null}, hr_actioned_at=NOW(),
        rejection_reason=${status === 'rejected' ? (rejection_reason ?? null) : null}
      WHERE id=${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const w = rows[0] as any;
    if (status === 'approved') {
      await markWfhAttendance(w.employee_id, w.date, w.type);
      notifyEmployeeUser(w.employee_id, 'leave_approved', 'WFH Approved',
        `Your Work From Home request has been approved.`).catch(() => {});
    } else {
      await clearWfhAttendance(w.employee_id, w.date);
      notifyEmployeeUser(w.employee_id, 'leave_rejected', 'WFH Request Rejected',
        `Your Work From Home request was rejected.`).catch(() => {});
    }
    res.json(w);
  } catch (err: any) { console.error('[WFH HR patch]', err?.message ?? err); res.status(500).json({ error: err?.message ?? 'Server error' }); }
});

// PATCH /wfh/requests/:id/cancel
router.patch('/requests/:id/cancel', async (req, res) => {
  try {
    const { cancelled_by, cancellation_reason } = req.body;
    const rows = await sql`
      UPDATE wfh_requests SET status='cancelled', cancelled_by=${cancelled_by ?? null},
        cancelled_at=NOW(), cancellation_reason=${cancellation_reason ?? null}
      WHERE id=${req.params.id} AND status IN ('pending','approved') RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found or not cancellable' });
    const w = rows[0] as any;
    await clearWfhAttendance(w.employee_id, w.date);
    res.json(w);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;

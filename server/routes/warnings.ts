import { Router } from 'express';
import { sql } from '../db';
import { notifyEmployeeUser, notifyAdminsAndHR } from '../lib/notify';

const router = Router();

// ── Boot migrations ───────────────────────────────────────────────────────────
;(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS employee_warnings (
        id          TEXT PRIMARY KEY,
        employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name TEXT,
        reason      TEXT NOT NULL,
        severity    TEXT NOT NULL DEFAULT 'warning', -- warning | serious | final
        issued_by   TEXT,
        issued_by_role TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS employee_pips (
        id           TEXT PRIMARY KEY,
        employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name TEXT,
        start_date   DATE NOT NULL,
        end_date     DATE NOT NULL,
        reason       TEXT,
        goals        TEXT,
        status       TEXT NOT NULL DEFAULT 'active',  -- active | completed | dismissed
        created_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `;
  } catch (e) { console.error('[warnings migration]', e); }
})();

// ── Helpers ───────────────────────────────────────────────────────────────────
async function checkAndTriggerPip(employeeId: string, employeeName: string) {
  const warnings = await sql`SELECT id FROM employee_warnings WHERE employee_id = ${employeeId}` as any[];
  if (warnings.length >= 3) {
    // Only create a new PIP if there isn't already an active one
    const activePips = await sql`SELECT id FROM employee_pips WHERE employee_id = ${employeeId} AND status = 'active'` as any[];
    if (!activePips.length) {
      const id = `pip_${Date.now()}`;
      const today = new Date().toISOString().split('T')[0];
      const endDate = new Date(); endDate.setMonth(endDate.getMonth() + 1);
      const end = endDate.toISOString().split('T')[0];
      await sql`
        INSERT INTO employee_pips (id, employee_id, employee_name, start_date, end_date, reason, status)
        VALUES (${id}, ${employeeId}, ${employeeName ?? null}, ${today}, ${end},
          'Automatically triggered after 3 warnings', 'active')
      `;
      notifyEmployeeUser(employeeId, 'info',
        'Performance Improvement Plan Assigned',
        `You have been placed on a Performance Improvement Plan (PIP) effective ${today}. Duration: 1 month. Please speak to your HR manager.`
      ).catch(() => {});
      notifyAdminsAndHR('info', 'PIP Auto-Triggered',
        `${employeeName ?? 'Employee'} has been placed on a PIP after receiving 3 warnings.`
      ).catch(() => {});
    }
  }
}

// ── Warning routes ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { employee_id } = req.query;
    const rows = employee_id
      ? await sql`SELECT * FROM employee_warnings WHERE employee_id = ${employee_id as string} ORDER BY created_at DESC`
      : await sql`SELECT * FROM employee_warnings ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', async (req, res) => {
  try {
    const { employee_id, employee_name, reason, severity, issued_by, issued_by_role } = req.body;
    if (!employee_id || !reason?.trim()) return res.status(400).json({ error: 'employee_id and reason are required' });
    const id = `warn_${Date.now()}`;
    const rows = await sql`
      INSERT INTO employee_warnings (id, employee_id, employee_name, reason, severity, issued_by, issued_by_role)
      VALUES (${id}, ${employee_id}, ${employee_name ?? null}, ${reason.trim()}, ${severity ?? 'warning'}, ${issued_by ?? null}, ${issued_by_role ?? null})
      RETURNING *
    `;
    const warn = rows[0] as any;
    // Notify employee
    notifyEmployeeUser(employee_id, 'info', 'Warning Issued',
      `A ${severity ?? 'warning'} has been issued to you. Reason: ${reason.trim()}`).catch(() => {});
    // Check if PIP should be triggered
    await checkAndTriggerPip(employee_id, employee_name);
    res.status(201).json(warn);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await sql`DELETE FROM employee_warnings WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── PIP routes ────────────────────────────────────────────────────────────────

router.get('/pips', async (req, res) => {
  try {
    const { employee_id } = req.query;
    const rows = employee_id
      ? await sql`SELECT * FROM employee_pips WHERE employee_id = ${employee_id as string} ORDER BY created_at DESC`
      : await sql`SELECT * FROM employee_pips ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/pips/:id', async (req, res) => {
  try {
    const { status, goals } = req.body;
    const rows = await sql`
      UPDATE employee_pips SET status = ${status ?? 'active'}, goals = ${goals ?? null}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;

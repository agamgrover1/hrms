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
      // Notify employee
      notifyEmployeeUser(employeeId, 'pip_assigned',
        'Performance Improvement Plan Assigned',
        `You have been placed on a Performance Improvement Plan (PIP) effective ${today} for 1 month. Please speak to your HR manager.`
      ).catch(() => {});
      // Notify HR/Admin
      notifyAdminsAndHR('pip_assigned',
        'PIP Auto-Triggered',
        `${employeeName ?? 'An employee'} has been placed on a PIP after receiving 3 warnings. PIP period: ${today} to ${end}.`
      ).catch(() => {});
      // Notify the reporting manager of this employee
      notifyManagerOfEmployee(employeeId,
        'pip_assigned',
        'Team Member Placed on PIP',
        `${employeeName ?? 'Your team member'} has been placed on a Performance Improvement Plan after 3 warnings.`
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
    const sevLabel = (severity ?? 'warning').charAt(0).toUpperCase() + (severity ?? 'warning').slice(1);

    // 1. Notify the employee who received the warning
    notifyEmployeeUser(employee_id, 'warning_issued',
      `${sevLabel} Warning Issued`,
      `A ${severity ?? 'warning'} warning has been issued by ${issued_by ?? 'HR/Admin'}. Reason: ${reason.trim()}`
    ).catch(() => {});

    // 2. If issued by a manager → notify HR/Admin so they're aware
    if (issued_by_role === 'manager' || issued_by_role === 'employee') {
      notifyAdminsAndHR('warning_issued',
        `Warning Issued by Manager`,
        `${issued_by ?? 'A manager'} issued a ${severity ?? 'warning'} warning to ${employee_name ?? 'an employee'}. Reason: ${reason.trim()}`
      ).catch(() => {});
    }

    // 3. If issued by HR/Admin → notify the reporting manager so they're aware
    if (issued_by_role === 'admin' || issued_by_role === 'hr_manager') {
      notifyManagerOfEmployee(employee_id,
        'warning_issued',
        `Warning Issued to Your Team Member`,
        `HR issued a ${severity ?? 'warning'} warning to ${employee_name ?? 'your team member'}. Reason: ${reason.trim()}`
      ).catch(() => {});
    }

    // Check if PIP should be triggered (sends its own notifications)
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

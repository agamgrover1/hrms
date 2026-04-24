import { Router } from 'express';
import { sql } from '../db';
import { notifyAdminsAndHR, notifyEmployeeUser, notifyManagerOfEmployee } from '../lib/notify';

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function isOnProbation(joinDate: string | null, probationEndDate?: string | null): boolean {
  if (!joinDate) return false;
  const end = probationEndDate
    ? new Date(probationEndDate)
    : (() => { const d = new Date(joinDate); d.setDate(d.getDate() + 90); return d; })();
  return new Date() < end;
}

// Credit monthly leave if a new month has started since last credit.
// full_day accumulates; short_leave resets to 2 each month.
async function creditMonthlyLeave(employeeId: string, joinDate: string | null) {
  const now = new Date();
  const cm = now.getMonth() + 1;
  const cy = now.getFullYear();
  const balRows = await sql`SELECT * FROM leave_balances WHERE employee_id = ${employeeId}`;
  if (!balRows.length) return;
  const bal = balRows[0] as any;
  if (bal.last_credited_month === cm && bal.last_credited_year === cy) return; // already credited

  const onProbation = isOnProbation(joinDate);
  if (onProbation) {
    // No monthly credit during probation — just update credit date
    await sql`UPDATE leave_balances SET last_credited_month=${cm}, last_credited_year=${cy} WHERE employee_id=${employeeId}`;
    return;
  }

  // Count full months to credit since last credit
  const lastM = bal.last_credited_month ?? cm;
  const lastY = bal.last_credited_year ?? cy;
  const monthsElapsed = Math.max(1, (cy - lastY) * 12 + (cm - lastM));

  await sql`
    UPDATE leave_balances
    SET full_day = COALESCE(full_day, 0) + ${monthsElapsed},
        short_leave = 2,
        last_credited_month = ${cm},
        last_credited_year  = ${cy}
    WHERE employee_id = ${employeeId}
  `;
}

// Deduct balance at approval time (unpaid leave has no balance to deduct)
async function deductBalance(employeeId: string, type: string, days: number) {
  if (type === 'full_day') {
    await sql`UPDATE leave_balances SET full_day = GREATEST(0, full_day - ${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'half_day') {
    await sql`UPDATE leave_balances SET short_leave = GREATEST(0, short_leave - 2) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'short_leave') {
    await sql`UPDATE leave_balances SET short_leave = GREATEST(0, short_leave - 1) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'casual') {
    await sql`UPDATE leave_balances SET casual = GREATEST(0, casual - ${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'sick') {
    await sql`UPDATE leave_balances SET sick = GREATEST(0, sick - ${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'earned') {
    await sql`UPDATE leave_balances SET earned = GREATEST(0, earned - ${days}) WHERE employee_id=${employeeId}`.catch(() => {});
  }
  // 'unpaid' — no balance to deduct
}

// Restore balance when a leave is cancelled (inverse of deductBalance)
async function restoreBalance(employeeId: string, type: string, days: number) {
  if (type === 'full_day') {
    await sql`UPDATE leave_balances SET full_day = full_day + ${days} WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'half_day') {
    await sql`UPDATE leave_balances SET short_leave = short_leave + 2 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'short_leave') {
    await sql`UPDATE leave_balances SET short_leave = short_leave + 1 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'casual') {
    await sql`UPDATE leave_balances SET casual = casual + ${days} WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'sick') {
    await sql`UPDATE leave_balances SET sick = sick + ${days} WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (type === 'earned') {
    await sql`UPDATE leave_balances SET earned = earned + ${days} WHERE employee_id=${employeeId}`.catch(() => {});
  }
  // 'unpaid' — no balance to restore
}

// Neon returns DATE columns as "YYYY-MM-DDT18:30:00.000Z" (IST midnight stored as UTC).
// Adding +5:30 (IST offset) converts the UTC timestamp back to the correct IST date string.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30

function neonDateToStr(d: string): string {
  if (!d) return '';
  if (!d.includes('T')) return d.slice(0, 10); // already "YYYY-MM-DD"
  return new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Clear leave attendance records when a leave is cancelled
async function clearLeaveAttendance(employeeId: string, fromDate: string, toDate: string) {
  const leaveStatuses = ['on_leave', 'half-day', 'short_leave', 'unpaid_leave'];
  let current = neonDateToStr(fromDate);
  const end    = neonDateToStr(toDate);
  while (current <= end) {
    await sql`
      DELETE FROM attendance_records
      WHERE employee_id=${employeeId} AND date::date=${current}::date
        AND status = ANY(${leaveStatuses})
    `.catch(() => {});
    current = nextDay(current);
  }
}

// Map leave type → attendance status
const LEAVE_TYPE_ATT_STATUS: Record<string, string> = {
  full_day:    'on_leave',
  half_day:    'half-day',
  short_leave: 'short_leave',
  unpaid:      'unpaid_leave',
  casual:      'on_leave',
  sick:        'on_leave',
  earned:      'on_leave',
};

// Restore one day's worth of balance when overriding an existing leave attendance record
async function restoreOneDayBalance(employeeId: string, oldAttStatus: string) {
  if (oldAttStatus === 'on_leave') {
    await sql`UPDATE leave_balances SET full_day = full_day + 1 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (oldAttStatus === 'half-day') {
    await sql`UPDATE leave_balances SET short_leave = short_leave + 2 WHERE employee_id=${employeeId}`.catch(() => {});
  } else if (oldAttStatus === 'short_leave') {
    await sql`UPDATE leave_balances SET short_leave = short_leave + 1 WHERE employee_id=${employeeId}`.catch(() => {});
  }
  // unpaid_leave: nothing to restore
}

// Mark attendance_records for each day in the approved leave range.
// If a date already has a leave-type status, the old balance is restored before overriding.
async function markLeaveAttendance(employeeId: string, fromDate: string, toDate: string, type: string) {
  const attStatus = LEAVE_TYPE_ATT_STATUS[type] ?? 'on_leave';
  const leaveStatuses = new Set(['on_leave', 'short_leave', 'half-day', 'unpaid_leave']);
  let current = neonDateToStr(fromDate);
  const end    = neonDateToStr(toDate);
  while (current <= end) {
    const dateStr = current;
    // Check for an existing leave attendance on this date
    const existing = await sql`
      SELECT status FROM attendance_records
      WHERE employee_id=${employeeId} AND date::date=${dateStr}::date
    `.catch(() => []);
    const oldStatus = (existing[0] as any)?.status;
    if (oldStatus && leaveStatuses.has(oldStatus) && oldStatus !== attStatus) {
      await restoreOneDayBalance(employeeId, oldStatus);
    }
    await sql`
      INSERT INTO attendance_records (employee_id, date, status, total_hours)
      VALUES (${employeeId}, ${dateStr}, ${attStatus}, 0)
      ON CONFLICT (employee_id, date) DO UPDATE SET status = ${attStatus}
    `.catch(() => {});
    current = nextDay(current);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

router.get('/requests', async (req, res) => {
  try {
    const { employee_id, status, reporting_manager_id } = req.query;
    let rows;
    if (reporting_manager_id) {
      rows = await sql`
        SELECT lr.* FROM leave_requests lr
        JOIN employees e ON e.id = lr.employee_id
        WHERE e.reporting_manager_id = ${reporting_manager_id as string}
          AND lr.manager_status = 'pending'
          AND lr.status = 'pending'
        ORDER BY lr.applied_on DESC
      `;
    } else if (employee_id) {
      rows = await sql`SELECT * FROM leave_requests WHERE employee_id = ${employee_id as string} ORDER BY applied_on DESC`;
    } else if (status) {
      rows = await sql`SELECT * FROM leave_requests WHERE status = ${status as string} ORDER BY applied_on DESC`;
    } else {
      rows = await sql`SELECT * FROM leave_requests ORDER BY applied_on DESC`;
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/requests', async (req, res) => {
  try {
    const { employee_id, employee_name, type, from_date, to_date, days, reason } = req.body;

    // Get employee join_date + probation_end_date for probation check
    const empRows = await sql`SELECT join_date, probation_end_date FROM employees WHERE id = ${employee_id}`;
    const joinDate = (empRows[0] as any)?.join_date ?? null;
    const probationEndDate = (empRows[0] as any)?.probation_end_date ?? null;
    const onProbation = isOnProbation(joinDate, probationEndDate);

    // Unpaid leave is always allowed (no balance required)
    const isUnpaid = type === 'unpaid';

    // Validate leave type and balance
    if (!isUnpaid && onProbation) {
      if (type === 'full_day') {
        return res.status(400).json({ error: 'Full day leaves are not allowed during the 90-day probation period.' });
      }
      const balRows = await sql`SELECT probation_short_used FROM leave_balances WHERE employee_id=${employee_id}`;
      const used = (balRows[0] as any)?.probation_short_used ?? 0;
      const cost = type === 'half_day' ? 2 : 1;
      if (used + cost > 2) {
        return res.status(400).json({ error: 'Probation leave limit exceeded. You may only take 2 short leaves or 1 half day during your probation period.' });
      }
      // Reserve probation quota immediately on application
      await sql`UPDATE leave_balances SET probation_short_used = ${used + cost} WHERE employee_id=${employee_id}`;
    } else if (!isUnpaid) {
      // Auto-credit if new month
      await creditMonthlyLeave(employee_id, joinDate);
      const balRows = await sql`SELECT full_day, short_leave FROM leave_balances WHERE employee_id=${employee_id}`;
      const bal = balRows[0] as any;
      if (type === 'full_day' && (bal?.full_day ?? 0) < 1) {
        return res.status(400).json({ error: 'No full day leave balance available.' });
      }
      if (type === 'half_day' && (bal?.short_leave ?? 0) < 2) {
        return res.status(400).json({ error: 'No half day leave balance available (requires 2 short leave credits).' });
      }
      if (type === 'short_leave' && (bal?.short_leave ?? 0) < 1) {
        return res.status(400).json({ error: 'No short leave balance available.' });
      }
    }

    const id = `l_${Date.now()}`;
    const rows = await sql`
      INSERT INTO leave_requests (id, employee_id, employee_name, type, from_date, to_date, days, reason, status, manager_status)
      VALUES (${id}, ${employee_id}, ${employee_name}, ${type}, ${from_date}, ${to_date}, ${days}, ${reason}, 'pending', 'pending')
      RETURNING *
    `;
    const from = new Date(from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyManagerOfEmployee(
      employee_id,
      'leave_applied',
      'New Leave Request',
      `${employee_name} applied for ${type.replace('_', ' ')} leave (${from} – ${to})`
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Manager first-level approval
router.patch('/requests/:id/manager-approve', async (req, res) => {
  try {
    const { status, manager_id, manager_name, rejection_reason } = req.body;
    if (status === 'rejected') {
      const rows = await sql`
        UPDATE leave_requests
        SET manager_status='rejected', manager_id=${manager_id ?? null},
            manager_name=${manager_name ?? null},
            manager_rejection_reason=${rejection_reason ?? null},
            manager_approved_at=NOW(), status='rejected'
        WHERE id=${req.params.id} RETURNING *
      `;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const leave = rows[0] as any;
      // Restore probation quota if applicable
      const empRows = await sql`SELECT join_date FROM employees WHERE id=${leave.employee_id}`;
      if (isOnProbation((empRows[0] as any)?.join_date)) {
        const cost = leave.type === 'half_day' ? 2 : 1;
        await sql`UPDATE leave_balances SET probation_short_used = GREATEST(0, probation_short_used - ${cost}) WHERE employee_id=${leave.employee_id}`.catch(() => {});
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
      WHERE id=${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyAdminsAndHR('leave_applied', 'Leave Needs HR Approval',
      `${leave.employee_name}'s ${leave.type.replace('_',' ')} leave (${from} – ${to}) approved by manager — awaiting your final approval.`);
    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// HR final approval — deducts balance here and marks attendance
router.patch('/requests/:id', async (req, res) => {
  try {
    const { status, actioner_name, rejection_reason } = req.body;
    const rows = await sql`
      UPDATE leave_requests
      SET status=${status},
          hr_actioner_name=${actioner_name ?? null},
          hr_actioned_at=NOW(),
          rejection_reason=${status === 'rejected' ? (rejection_reason ?? null) : null}
      WHERE id=${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    if (status === 'approved') {
      await deductBalance(leave.employee_id, leave.type, leave.days);
      await markLeaveAttendance(leave.employee_id, leave.from_date, leave.to_date, leave.type);
    } else {
      // Rejected — restore probation quota if applicable
      const empRows = await sql`SELECT join_date FROM employees WHERE id=${leave.employee_id}`;
      if (isOnProbation((empRows[0] as any)?.join_date)) {
        const cost = leave.type === 'half_day' ? 2 : 1;
        await sql`UPDATE leave_balances SET probation_short_used = GREATEST(0, probation_short_used - ${cost}) WHERE employee_id=${leave.employee_id}`.catch(() => {});
      }
    }
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyEmployeeUser(leave.employee_id,
      status === 'approved' ? 'leave_approved' : 'leave_rejected',
      status === 'approved' ? 'Leave Approved' : 'Leave Rejected',
      `Your ${leave.type.replace('_',' ')} leave (${from} – ${to}) has been ${status}.`);
    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Cancel an approved leave — restores balance and clears attendance
router.patch('/requests/:id/cancel', async (req, res) => {
  try {
    const { cancelled_by, cancellation_reason } = req.body;
    const existing = await sql`SELECT * FROM leave_requests WHERE id=${req.params.id}`;
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const leave = existing[0] as any;
    if (leave.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved leaves can be cancelled.' });
    }
    const rows = await sql`
      UPDATE leave_requests
      SET status='cancelled', cancelled_by=${cancelled_by ?? null},
          cancelled_at=NOW(), cancellation_reason=${cancellation_reason ?? null}
      WHERE id=${req.params.id} RETURNING *
    `;
    await restoreBalance(leave.employee_id, leave.type, leave.days);
    await clearLeaveAttendance(leave.employee_id, leave.from_date, leave.to_date);
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyEmployeeUser(leave.employee_id, 'leave_rejected', 'Leave Cancelled',
      `Your approved ${leave.type.replace('_',' ')} leave (${from} – ${to}) was cancelled by ${cancelled_by ?? 'admin'}.${cancellation_reason ? ' Reason: ' + cancellation_reason : ''}`);
    res.json(rows[0]);
  } catch (err) {
    console.error('[PATCH cancel leave]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/requests/:id', async (req, res) => {
  try {
    await sql`DELETE FROM leave_requests WHERE id=${req.params.id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin/HR manual balance adjustment
router.patch('/balances/:employee_id', async (req, res) => {
  try {
    const { full_day, short_leave } = req.body;
    const rows = await sql`
      INSERT INTO leave_balances (employee_id, full_day, short_leave)
      VALUES (${req.params.employee_id}, ${Number(full_day)}, ${Number(short_leave)})
      ON CONFLICT (employee_id) DO UPDATE
        SET full_day = ${Number(full_day)}, short_leave = ${Number(short_leave)}
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err: any) {
    console.error('[PATCH leave balance]', err);
    res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.get('/balances/:employee_id', async (req, res) => {
  try {
    // Auto-credit monthly leave before returning balance
    const empRows = await sql`SELECT join_date, probation_end_date FROM employees WHERE id=${req.params.employee_id}`;
    const joinDate = (empRows[0] as any)?.join_date ?? null;
    const probationEndDate = (empRows[0] as any)?.probation_end_date ?? null;
    await creditMonthlyLeave(req.params.employee_id, joinDate).catch(() => {});

    const rows = await sql`SELECT * FROM leave_balances WHERE employee_id=${req.params.employee_id}`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const bal = rows[0] as any;
    // Attach computed probation info
    bal.on_probation = isOnProbation(joinDate, probationEndDate);
    bal.probation_end_date = probationEndDate;
    bal.probation_short_remaining = Math.max(0, 2 - (bal.probation_short_used ?? 0));
    res.json(bal);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

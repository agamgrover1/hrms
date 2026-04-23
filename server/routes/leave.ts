import { Router } from 'express';
import { sql } from '../db';
import { notifyAdminsAndHR, notifyEmployeeUser, notifyManagerOfEmployee } from '../lib/notify';

const router = Router();

router.get('/requests', async (req, res) => {
  try {
    const { employee_id, status, reporting_manager_id } = req.query;
    let rows;
    if (reporting_manager_id) {
      // Team pending leaves for a manager's direct reports
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
    const id = `l_${Date.now()}`;
    const rows = await sql`
      INSERT INTO leave_requests (id, employee_id, employee_name, type, from_date, to_date, days, reason, status, manager_status)
      VALUES (${id}, ${employee_id}, ${employee_name}, ${type}, ${from_date}, ${to_date}, ${days}, ${reason}, 'pending', 'pending')
      RETURNING *
    `;
    const from = new Date(from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    // Notify reporting manager; falls back to HR/admin if no manager
    notifyManagerOfEmployee(
      employee_id,
      'leave_applied',
      'New Leave Request',
      `${employee_name} applied for ${days}-day ${type} leave (${from} – ${to})`
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Manager first-level approval
router.patch('/requests/:id/manager-approve', async (req, res) => {
  try {
    const { status, manager_id } = req.body; // status: 'approved' | 'rejected'
    if (status === 'rejected') {
      // Manager rejects → final rejection
      const rows = await sql`
        UPDATE leave_requests
        SET manager_status = 'rejected', manager_id = ${manager_id ?? null},
            manager_approved_at = NOW(), status = 'rejected'
        WHERE id = ${req.params.id} RETURNING *
      `;
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      const leave = rows[0] as any;
      const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      notifyEmployeeUser(
        leave.employee_id,
        'leave_rejected',
        'Leave Rejected by Manager',
        `Your ${leave.type} leave (${from} – ${to}, ${leave.days} day${leave.days > 1 ? 's' : ''}) was rejected by your manager.`
      );
      return res.json(leave);
    }
    // Manager approves → set manager_status, status stays pending for HR
    const rows = await sql`
      UPDATE leave_requests
      SET manager_status = 'approved', manager_id = ${manager_id ?? null},
          manager_approved_at = NOW()
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    // Notify HR/admin for final approval
    notifyAdminsAndHR(
      'leave_applied',
      'Leave Needs HR Approval',
      `${leave.employee_name}'s ${leave.type} leave (${from} – ${to}) approved by manager — awaiting your final approval.`
    );
    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// HR final approval
router.patch('/requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const rows = await sql`
      UPDATE leave_requests SET status = ${status} WHERE id = ${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    // Decrement leave balance when approved
    if (status === 'approved') {
      if (leave.type === 'casual') {
        await sql`UPDATE leave_balances SET casual = GREATEST(0, casual - ${leave.days}) WHERE employee_id = ${leave.employee_id}`.catch(() => {});
      } else if (leave.type === 'sick') {
        await sql`UPDATE leave_balances SET sick = GREATEST(0, sick - ${leave.days}) WHERE employee_id = ${leave.employee_id}`.catch(() => {});
      } else if (leave.type === 'earned') {
        await sql`UPDATE leave_balances SET earned = GREATEST(0, earned - ${leave.days}) WHERE employee_id = ${leave.employee_id}`.catch(() => {});
      }
    }
    const from = new Date(leave.from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(leave.to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const isApproved = status === 'approved';
    notifyEmployeeUser(
      leave.employee_id,
      isApproved ? 'leave_approved' : 'leave_rejected',
      isApproved ? 'Leave Approved' : 'Leave Rejected',
      `Your ${leave.type} leave (${from} – ${to}, ${leave.days} day${leave.days > 1 ? 's' : ''}) has been ${status}.`
    );
    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/requests/:id', async (req, res) => {
  try {
    await sql`DELETE FROM leave_requests WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/balances/:employee_id', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM leave_balances WHERE employee_id = ${req.params.employee_id}`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

import { Router } from 'express';
import { sql } from '../db';
import { notifyAdminsAndHR, notifyEmployeeUser } from '../lib/notify';

const router = Router();

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

router.get('/requests', async (req, res) => {
  try {
    const { employee_id, status } = req.query;
    let rows;
    if (employee_id) {
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
      INSERT INTO leave_requests (id, employee_id, employee_name, type, from_date, to_date, days, reason, status)
      VALUES (${id}, ${employee_id}, ${employee_name}, ${type}, ${from_date}, ${to_date}, ${days}, ${reason}, 'pending')
      RETURNING *
    `;
    // Notify HR/admin
    const from = new Date(from_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const to   = new Date(to_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    notifyAdminsAndHR(
      'leave_applied',
      'New Leave Request',
      `${employee_name} applied for ${days}-day ${type} leave (${from} – ${to})`
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/requests/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const rows = await sql`
      UPDATE leave_requests SET status = ${status} WHERE id = ${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const leave = rows[0] as any;
    // Notify the employee
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

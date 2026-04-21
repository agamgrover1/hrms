import { Router } from 'express';
import { sql } from '../db';

const router = Router();

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
    res.json(rows[0]);
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

import { Router } from 'express';
import { sql } from '../db';

const router = Router();

router.get('/goals', async (req, res) => {
  try {
    const { employee_id } = req.query;
    const rows = employee_id
      ? await sql`SELECT * FROM goals WHERE employee_id = ${employee_id as string} ORDER BY due_date`
      : await sql`SELECT * FROM goals ORDER BY due_date`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/goals/:id', async (req, res) => {
  try {
    const { progress, status } = req.body;
    const rows = await sql`
      UPDATE goals SET progress = ${progress}, status = ${status} WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/reviews', async (req, res) => {
  try {
    const { employee_id } = req.query;
    const rows = employee_id
      ? await sql`SELECT r.*, e.name as reviewer_name FROM reviews r JOIN employees e ON r.reviewer_id = e.id WHERE r.employee_id = ${employee_id as string} ORDER BY r.review_date DESC`
      : await sql`SELECT r.*, e.name as reviewer_name FROM reviews r JOIN employees e ON r.reviewer_id = e.id ORDER BY r.review_date DESC`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

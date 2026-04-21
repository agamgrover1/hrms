import { Router } from 'express';
import { sql } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { employee_id, month, year } = req.query;
    let rows;
    if (employee_id && month && year) {
      rows = await sql`
        SELECT * FROM attendance_records
        WHERE employee_id = ${employee_id as string}
          AND EXTRACT(MONTH FROM date) = ${Number(month)}
          AND EXTRACT(YEAR FROM date) = ${Number(year)}
        ORDER BY date
      `;
    } else if (employee_id) {
      rows = await sql`SELECT * FROM attendance_records WHERE employee_id = ${employee_id as string} ORDER BY date DESC`;
    } else {
      rows = await sql`SELECT * FROM attendance_records ORDER BY date DESC, employee_id`;
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/clock-in', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const time = now.toTimeString().slice(0, 5);
    const hour = now.getHours();
    const status = hour >= 10 ? 'late' : 'present';
    const rows = await sql`
      INSERT INTO attendance_records (employee_id, date, check_in, status, total_hours)
      VALUES (${employee_id}, ${today}, ${time}, ${status}, 0)
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in = ${time}, status = ${status}
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/clock-out', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const time = new Date().toTimeString().slice(0, 5);
    const rows = await sql`
      UPDATE attendance_records SET check_out = ${time},
        total_hours = ROUND(EXTRACT(EPOCH FROM (${time}::time - check_in::time)) / 3600, 1)
      WHERE employee_id = ${employee_id} AND date = ${today}
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

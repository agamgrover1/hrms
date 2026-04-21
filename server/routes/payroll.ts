import { Router } from 'express';
import { sql } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { month, year } = req.query;
    let rows;
    if (month && year) {
      rows = await sql`
        SELECT pr.*, e.name, e.designation, e.avatar, e.employee_id as emp_id, e.department
        FROM payroll_records pr JOIN employees e ON pr.employee_id = e.id
        WHERE pr.month = ${month as string} AND pr.year = ${Number(year)}
        ORDER BY e.name
      `;
    } else {
      rows = await sql`
        SELECT pr.*, e.name, e.designation, e.avatar, e.employee_id as emp_id, e.department
        FROM payroll_records pr JOIN employees e ON pr.employee_id = e.id
        ORDER BY pr.year DESC, pr.month DESC, e.name
      `;
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:employee_id', async (req, res) => {
  try {
    const rows = await sql`
      SELECT * FROM payroll_records WHERE employee_id = ${req.params.employee_id} ORDER BY year DESC, month DESC
    `;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

import { Router } from 'express';
import { sql } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { reporting_manager_id } = req.query;
    const rows = reporting_manager_id
      ? await sql`SELECT * FROM employees WHERE reporting_manager_id = ${reporting_manager_id as string} ORDER BY name`
      : await sql`SELECT * FROM employees ORDER BY name`;
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const rows = await sql`SELECT * FROM employees WHERE id = ${req.params.id}`;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { id, name, email, phone, department, designation, employee_id, join_date, location, manager, reporting_manager_id, status, avatar, salary, ctc } = req.body;
    const rows = await sql`
      INSERT INTO employees (id, name, email, phone, department, designation, employee_id, join_date, location, manager, reporting_manager_id, status, avatar, salary, ctc)
      VALUES (${id}, ${name}, ${email}, ${phone}, ${department}, ${designation}, ${employee_id}, ${join_date}, ${location}, ${manager ?? null}, ${reporting_manager_id ?? null}, ${status ?? 'active'}, ${avatar}, ${salary}, ${ctc})
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (err: any) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'Employee ID or email already exists' });
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, email, phone, department, designation, location, manager, reporting_manager_id, status, salary, ctc, next_appraisal_month, next_appraisal_year } = req.body;
    const rows = await sql`
      UPDATE employees SET
        name = ${name}, email = ${email}, phone = ${phone}, department = ${department},
        designation = ${designation}, location = ${location}, manager = ${manager ?? null},
        reporting_manager_id = ${reporting_manager_id ?? null},
        status = ${status}, salary = ${salary}, ctc = ${ctc},
        next_appraisal_month = ${next_appraisal_month ?? null},
        next_appraisal_year  = ${next_appraisal_year  ?? null}
      WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT employee]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

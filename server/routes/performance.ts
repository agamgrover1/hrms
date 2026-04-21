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

// Monthly performance
router.get('/monthly', async (req, res) => {
  try {
    const { employee_id, year } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const rows = year
      ? await sql`SELECT * FROM monthly_performance WHERE employee_id = ${employee_id as string} AND year = ${Number(year)} ORDER BY month`
      : await sql`SELECT * FROM monthly_performance WHERE employee_id = ${employee_id as string} ORDER BY year, month`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/monthly', async (req, res) => {
  try {
    const { employee_id, reviewer_id, reviewer_name, month, year, productivity, quality, teamwork, attendance_score, initiative, overall_score, comments } = req.body;
    const rows = await sql`
      INSERT INTO monthly_performance
        (employee_id, reviewer_id, reviewer_name, month, year, productivity, quality, teamwork, attendance_score, initiative, overall_score, comments, updated_at)
      VALUES
        (${employee_id}, ${reviewer_id ?? null}, ${reviewer_name ?? null}, ${month}, ${year},
         ${productivity}, ${quality}, ${teamwork}, ${attendance_score}, ${initiative}, ${overall_score}, ${comments ?? null}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        reviewer_id = EXCLUDED.reviewer_id,
        reviewer_name = EXCLUDED.reviewer_name,
        productivity = EXCLUDED.productivity,
        quality = EXCLUDED.quality,
        teamwork = EXCLUDED.teamwork,
        attendance_score = EXCLUDED.attendance_score,
        initiative = EXCLUDED.initiative,
        overall_score = EXCLUDED.overall_score,
        comments = EXCLUDED.comments,
        updated_at = NOW()
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Performance notes (private — not for employees)
router.get('/notes', async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const rows = await sql`SELECT * FROM performance_notes WHERE employee_id = ${employee_id as string} ORDER BY note_date DESC, created_at DESC`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/notes', async (req, res) => {
  try {
    const { employee_id, note_date, note_text, note_type, created_by_id, created_by_name } = req.body;
    const rows = await sql`
      INSERT INTO performance_notes (employee_id, note_date, note_text, note_type, created_by_id, created_by_name)
      VALUES (${employee_id}, ${note_date}, ${note_text}, ${note_type ?? 'neutral'}, ${created_by_id ?? null}, ${created_by_name ?? null})
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/notes/:id', async (req, res) => {
  try {
    await sql`DELETE FROM performance_notes WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

import { Router } from 'express';
import { sql } from '../db';
import { notifyAdminsAndHR, notifyEmployeeUser } from '../lib/notify';

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

// Boot-time migration for new monthly_performance columns
;(async () => {
  try {
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS ai_usage INTEGER DEFAULT 75`;
    await sql`ALTER TABLE monthly_performance ADD COLUMN IF NOT EXISTS parameter_notes JSONB DEFAULT '{}'`;
  } catch { /* ignore */ }
})();

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
    const { employee_id, reviewer_id, reviewer_name, month, year, productivity, quality, teamwork, attendance_score, initiative, client_satisfaction, ai_usage, overall_score, comments, parameter_notes } = req.body;
    const paramNotesJson = JSON.stringify(parameter_notes ?? {});
    const rows = await sql`
      INSERT INTO monthly_performance
        (employee_id, reviewer_id, reviewer_name, month, year, productivity, quality, teamwork, attendance_score, initiative, client_satisfaction, ai_usage, overall_score, comments, parameter_notes, updated_at)
      VALUES
        (${employee_id}, ${reviewer_id ?? null}, ${reviewer_name ?? null}, ${month}, ${year},
         ${productivity}, ${quality}, ${teamwork}, ${attendance_score}, ${initiative}, ${client_satisfaction ?? 0}, ${ai_usage ?? 75}, ${overall_score}, ${comments ?? null}, ${paramNotesJson}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        reviewer_id = EXCLUDED.reviewer_id,
        reviewer_name = EXCLUDED.reviewer_name,
        productivity = EXCLUDED.productivity,
        quality = EXCLUDED.quality,
        teamwork = EXCLUDED.teamwork,
        attendance_score = EXCLUDED.attendance_score,
        initiative = EXCLUDED.initiative,
        client_satisfaction = EXCLUDED.client_satisfaction,
        ai_usage = EXCLUDED.ai_usage,
        overall_score = EXCLUDED.overall_score,
        comments = EXCLUDED.comments,
        parameter_notes = EXCLUDED.parameter_notes,
        updated_at = NOW()
      RETURNING *
    `;
    // Notify the employee about their review
    const rec = rows[0] as any;
    const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][rec.month - 1];
    notifyEmployeeUser(
      rec.employee_id,
      'review_added',
      'Performance Review Added',
      `Your ${monthName} ${rec.year} performance review is in — overall score: ${rec.overall_score}/100.`
    );
    res.json(rec);
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

// Appraisal Goals
router.get('/appraisal-goals', async (req, res) => {
  try {
    const { employee_id, year } = req.query;
    if (employee_id) {
      // Return all submissions for this employee, newest first
      const rows = await sql`
        SELECT * FROM appraisal_goals WHERE employee_id = ${employee_id as string}
        ORDER BY year DESC, month DESC
      `;
      res.json(rows);
    } else if (year) {
      // Admin view: all employees for a given year
      const rows = await sql`
        SELECT ag.*, e.name as employee_name, e.designation, e.department
        FROM appraisal_goals ag JOIN employees e ON ag.employee_id = e.id
        WHERE ag.year = ${Number(year)} ORDER BY e.name, ag.month DESC
      `;
      res.json(rows);
    } else {
      res.status(400).json({ error: 'employee_id or year is required' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/appraisal-goals', async (req, res) => {
  try {
    const { employee_id, year, month, goals } = req.body;
    const rows = await sql`
      INSERT INTO appraisal_goals (employee_id, year, month, goals, updated_at)
      VALUES (${employee_id}, ${year}, ${month}, ${JSON.stringify(goals)}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        goals = EXCLUDED.goals,
        updated_at = NOW()
      WHERE appraisal_goals.submitted = FALSE
      RETURNING *
    `;
    if (!rows.length) return res.status(403).json({ error: 'Goals already submitted and locked.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/appraisal-goals/submit', async (req, res) => {
  try {
    const { employee_id, year, month, goals } = req.body;
    const rows = await sql`
      INSERT INTO appraisal_goals (employee_id, year, month, goals, submitted, submitted_at, updated_at)
      VALUES (${employee_id}, ${year}, ${month}, ${JSON.stringify(goals)}, TRUE, NOW(), NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        goals = EXCLUDED.goals,
        submitted = TRUE,
        submitted_at = NOW(),
        updated_at = NOW()
      WHERE appraisal_goals.submitted = FALSE
      RETURNING *
    `;
    if (!rows.length) return res.status(403).json({ error: 'Already submitted.' });
    const rec = rows[0] as any;
    const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][rec.month - 1];
    // Find employee name for the notification body
    const empRows = await sql`SELECT name FROM employees WHERE id = ${rec.employee_id}`.catch(() => []);
    const empName = (empRows as any[])[0]?.name ?? 'An employee';
    notifyAdminsAndHR(
      'appraisal_submitted',
      'Appraisal Goals Submitted',
      `${empName} submitted ${rec.goals?.length ?? 0} appraisal goal(s) for ${monthName} ${rec.year}.`
    );
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Employee self-update: only employee_status fields, never goal text or manager status
router.patch('/appraisal-goals/self-update', async (req, res) => {
  try {
    const { employee_id, year, month, employee_statuses } = req.body;
    // employee_statuses: Array<{ index: number; employee_status: string }>
    const existing = await sql`
      SELECT * FROM appraisal_goals
      WHERE employee_id = ${employee_id} AND year = ${year} AND month = ${month}
    `;
    if (!existing.length) return res.status(404).json({ error: 'Not found' });
    const goals = [...((existing[0] as any).goals ?? [])];
    for (const { index, employee_status } of (employee_statuses ?? [])) {
      if (goals[index] !== undefined) {
        goals[index] = { ...goals[index], employee_status };
      }
    }
    const rows = await sql`
      UPDATE appraisal_goals SET goals = ${JSON.stringify(goals)}, updated_at = NOW()
      WHERE employee_id = ${employee_id} AND year = ${year} AND month = ${month}
      RETURNING *
    `;
    const rec = rows[0] as any;
    const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(month as number) - 1];
    notifyAdminsAndHR(
      'self_assessment_updated',
      'Self-Assessment Updated',
      `An employee updated their goal self-assessment for ${monthName} ${year}.`
    );
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin-only: force edit even after submission
router.put('/appraisal-goals/admin', async (req, res) => {
  try {
    const { employee_id, year, month, goals } = req.body;
    const rows = await sql`
      INSERT INTO appraisal_goals (employee_id, year, month, goals, updated_at)
      VALUES (${employee_id}, ${year}, ${month}, ${JSON.stringify(goals)}, NOW())
      ON CONFLICT (employee_id, month, year) DO UPDATE SET
        goals = EXCLUDED.goals,
        updated_at = NOW()
      RETURNING *
    `;
    const rec = rows[0] as any;
    const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(month as number) - 1];
    notifyEmployeeUser(
      employee_id as string,
      'appraisal_reviewed',
      'Appraisal Goals Reviewed',
      `Your appraisal goals for ${monthName} ${year} have been reviewed by your manager.`
    );
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

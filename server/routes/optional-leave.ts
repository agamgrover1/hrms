import { Router } from 'express';
import { sql } from '../db';

const router = Router();

// Boot migration
;(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS optional_leave_dates (
        id         TEXT PRIMARY KEY,
        date       DATE NOT NULL,
        label      TEXT NOT NULL,
        year       INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(date, year)
      )
    `;
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS date_of_birth DATE`;
  } catch (e) { console.error('[optional-leave migration]', e); }
})();

// GET /api/optional-leave/dates?year=2026
router.get('/dates', async (req, res) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const rows = await sql`
      SELECT * FROM optional_leave_dates WHERE year = ${year} ORDER BY date ASC
    `;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// POST /api/optional-leave/dates  { date, label, year }
router.post('/dates', async (req, res) => {
  try {
    const { date, label, year } = req.body;
    if (!date || !label?.trim() || !year) {
      return res.status(400).json({ error: 'date, label, year are required' });
    }
    const id = `old_${Date.now()}`;
    const rows = await sql`
      INSERT INTO optional_leave_dates (id, date, label, year)
      VALUES (${id}, ${date}, ${label.trim()}, ${Number(year)})
      ON CONFLICT (date, year) DO UPDATE SET label = EXCLUDED.label
      RETURNING *
    `;
    res.status(201).json(rows[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/optional-leave/dates/:id
router.delete('/dates/:id', async (req, res) => {
  try {
    await sql`DELETE FROM optional_leave_dates WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// GET /api/optional-leave/available?employee_id=...&year=2026
// Returns pool dates + employee birthday, minus dates already applied for
router.get('/available', async (req, res) => {
  try {
    const { employee_id, year: yearStr } = req.query as any;
    if (!employee_id) return res.status(400).json({ error: 'employee_id required' });
    const year = Number(yearStr) || new Date().getFullYear();

    // Pool dates for this year
    const pool = await sql`
      SELECT id, date, label FROM optional_leave_dates WHERE year = ${year} ORDER BY date ASC
    `;

    // Employee's date_of_birth for birthday leave
    const empRows = await sql`SELECT date_of_birth FROM employees WHERE id = ${employee_id}`;
    const dob = (empRows[0] as any)?.date_of_birth;
    const birthdayDateStr = dob
      ? (() => {
          const d = new Date(typeof dob === 'string' ? dob : (dob as Date).toISOString());
          // Offset for IST if needed
          const s = d.toISOString().includes('T18:30') || d.toISOString().includes('T') && false
            ? (() => { const x = new Date(d); x.setMinutes(x.getMinutes() + 330); return x.toISOString().slice(0, 10); })()
            : d.toISOString().slice(0, 10);
          // Replace year component with current year
          return `${year}-${s.slice(5)}`;
        })()
      : null;

    // Dates already applied for by this employee this year (pending or approved)
    const used = await sql`
      SELECT date FROM leave_requests
      WHERE employee_id = ${employee_id}
        AND type = 'optional'
        AND status NOT IN ('rejected', 'cancelled')
        AND EXTRACT(YEAR FROM from_date) = ${year}
    `;
    const usedSet = new Set((used as any[]).map(r => {
      const s = typeof r.date === 'string' ? r.date : (r.date as Date).toISOString();
      return s.includes('T') ? (() => { const d = new Date(s); d.setMinutes(d.getMinutes() + 330); return d.toISOString().slice(0, 10); })() : s.slice(0, 10);
    }));

    // Count of optional leaves used this year (pending + approved)
    const countRows = await sql`
      SELECT COUNT(*) FROM leave_requests
      WHERE employee_id = ${employee_id}
        AND type = 'optional'
        AND status NOT IN ('rejected', 'cancelled')
        AND EXTRACT(YEAR FROM from_date) = ${year}
    `;
    const usedCount = Number((countRows[0] as any).count);

    const normalise = (v: any): string => {
      const s = typeof v === 'string' ? v : (v instanceof Date ? v.toISOString() : String(v));
      if (s.includes('T')) {
        const d = new Date(s); d.setMinutes(d.getMinutes() + 330);
        return d.toISOString().slice(0, 10);
      }
      return s.slice(0, 10);
    };

    const dates: { id: string; date: string; label: string; is_birthday: boolean; already_applied: boolean }[] = [];

    for (const row of pool as any[]) {
      const dateStr = normalise(row.date);
      dates.push({
        id: row.id,
        date: dateStr,
        label: row.label,
        is_birthday: false,
        already_applied: usedSet.has(dateStr),
      });
    }

    // Add birthday if available and not already in pool
    if (birthdayDateStr && !dates.some(d => d.date === birthdayDateStr)) {
      dates.push({
        id: 'birthday',
        date: birthdayDateStr,
        label: 'Your Birthday 🎂',
        is_birthday: true,
        already_applied: usedSet.has(birthdayDateStr),
      });
      dates.sort((a, b) => a.date.localeCompare(b.date));
    }

    res.json({ dates, used_count: usedCount, remaining: Math.max(0, 2 - usedCount) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;

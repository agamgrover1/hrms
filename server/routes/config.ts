import { Router } from 'express';
import { sql } from '../db';

const router = Router();

// ── Boot-time: create tables + seed defaults ──────────────────────────────────
;(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS config_departments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS config_designations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS config_shifts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        late_after TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    // Seed default departments
    const defaultDepts = ['Engineering','Product','Design','HR','Sales','Finance','Marketing','Operations','Legal','Customer Support'];
    for (const d of defaultDepts) {
      await sql`INSERT INTO config_departments (id, name) VALUES (${d.toLowerCase().replace(/\s+/g,'-')}, ${d}) ON CONFLICT (id) DO NOTHING`;
    }
    // Seed default shifts — late_after = shift start (any minute after start = Late)
    await sql`INSERT INTO config_shifts (id, name, start_time, end_time, late_after) VALUES ('day','Day Shift','09:00','18:00','09:00') ON CONFLICT (id) DO NOTHING`;
    await sql`INSERT INTO config_shifts (id, name, start_time, end_time, late_after) VALUES ('night','Night Shift','18:30','03:30','18:30') ON CONFLICT (id) DO NOTHING`;
    // Fix existing records that still have old grace-period thresholds
    await sql`UPDATE config_shifts SET late_after = start_time WHERE id IN ('day','night') AND late_after != start_time`;
  } catch (e) { console.error('[config migration]', e); }
})();

// ── Departments ───────────────────────────────────────────────────────────────
router.get('/departments', async (_req, res) => {
  try {
    const rows = await sql`SELECT * FROM config_departments ORDER BY name`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/departments', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const rows = await sql`
      INSERT INTO config_departments (id, name) VALUES (${id}, ${name.trim()})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err: any) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'Department already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/departments/:id', async (req, res) => {
  try {
    await sql`DELETE FROM config_departments WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Designations ──────────────────────────────────────────────────────────────
router.get('/designations', async (_req, res) => {
  try {
    const rows = await sql`SELECT * FROM config_designations ORDER BY name`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/designations', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '-' + Date.now().toString(36);
    const rows = await sql`
      INSERT INTO config_designations (id, name) VALUES (${id}, ${name.trim()})
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err: any) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'Designation already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/designations/:id', async (req, res) => {
  try {
    await sql`DELETE FROM config_designations WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

// ── Shifts ────────────────────────────────────────────────────────────────────
router.get('/shifts', async (_req, res) => {
  try {
    const rows = await sql`SELECT * FROM config_shifts ORDER BY start_time`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/shifts', async (req, res) => {
  try {
    const { name, start_time, end_time, late_after } = req.body;
    if (!name?.trim() || !start_time || !end_time || !late_after) {
      return res.status(400).json({ error: 'name, start_time, end_time, late_after are required' });
    }
    const id = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const rows = await sql`
      INSERT INTO config_shifts (id, name, start_time, end_time, late_after)
      VALUES (${id}, ${name.trim()}, ${start_time}, ${end_time}, ${late_after})
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err: any) {
    if (err.message?.includes('unique')) return res.status(409).json({ error: 'Shift name already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/shifts/:id', async (req, res) => {
  try {
    const { name, start_time, end_time, late_after } = req.body;
    const rows = await sql`
      UPDATE config_shifts SET
        name = ${name}, start_time = ${start_time},
        end_time = ${end_time}, late_after = ${late_after}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Shift not found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/shifts/:id', async (req, res) => {
  try {
    await sql`DELETE FROM config_shifts WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;

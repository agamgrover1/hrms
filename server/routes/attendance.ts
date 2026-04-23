import { Router } from 'express';
import { sql } from '../db';
import { randomUUID } from 'crypto';

const router = Router();

// ── Boot-time migrations ────────────────────────────────────────────────────
;(async () => {
  try {
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual'`;
    await sql`ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS biometric_sync_id TEXT`;
    await sql`
      CREATE TABLE IF NOT EXISTS attendance_sync_log (
        id              SERIAL PRIMARY KEY,
        sync_id         TEXT NOT NULL UNIQUE,
        triggered       TEXT NOT NULL,
        triggered_by    TEXT,
        synced_at       TIMESTAMPTZ DEFAULT NOW(),
        date_range      TEXT,
        records_updated INTEGER DEFAULT 0,
        records_created INTEGER DEFAULT 0,
        status          TEXT DEFAULT 'success',
        error_msg       TEXT,
        is_rolled_back  BOOLEAN DEFAULT FALSE,
        rolled_back_at  TIMESTAMPTZ
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS attendance_sync_snapshot (
        id                 SERIAL PRIMARY KEY,
        sync_id            TEXT NOT NULL,
        employee_id        TEXT NOT NULL,
        date               DATE NOT NULL,
        had_record         BOOLEAN DEFAULT FALSE,
        status_before      TEXT,
        check_in_before    TEXT,
        check_out_before   TEXT,
        total_hours_before NUMERIC
      )
    `;
  } catch (e) { console.error('[attendance migration]', e); }
})();

// ── Helpers ─────────────────────────────────────────────────────────────────

function calcHours(checkIn: string, checkOut: string): number {
  return Math.round(
    ((new Date(`1970-01-01T${checkOut}`) as any) - (new Date(`1970-01-01T${checkIn}`) as any)) / 360000
  ) / 10;
}

function deriveStatus(checkInTime: string | null): string {
  if (!checkInTime) return 'absent';
  const hour = parseInt(checkInTime.split(':')[0], 10);
  return hour >= 10 ? 'late' : 'present';
}

// ── Core biometric sync function (exported for auto-sync in index.ts) ────────
export async function runBiometricSync(
  trigger: 'auto' | 'manual',
  triggeredBy?: string,
  targetDate?: string
): Promise<{ sync_id: string; records_updated: number; records_created: number; synced_at: string; date_range: string }> {
  const apiUrl  = process.env.BIOMETRIC_API_URL;
  const apiKey  = process.env.BIOMETRIC_API_KEY;
  if (!apiUrl) throw new Error('BIOMETRIC_API_URL is not configured in .env');

  const date = targetDate ?? new Date().toISOString().split('T')[0];

  // ── Env-configurable field names so any vendor JSON can be mapped ──
  const empIdField   = process.env.BIOMETRIC_EMP_ID_FIELD   ?? 'emp_id';
  const timeField    = process.env.BIOMETRIC_TIME_FIELD      ?? 'punch_time';
  const typeField    = process.env.BIOMETRIC_TYPE_FIELD      ?? 'punch_type';
  const inValue      = process.env.BIOMETRIC_TYPE_IN_VALUE   ?? 'IN';
  const outValue     = process.env.BIOMETRIC_TYPE_OUT_VALUE  ?? 'OUT';
  const dataField    = process.env.BIOMETRIC_DATA_FIELD      ?? 'data';

  // ── Fetch from biometric API ──────────────────────────────────────────────
  const url = `${apiUrl}?date=${date}`;
  const fetchRes = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });
  if (!fetchRes.ok) throw new Error(`Biometric API returned ${fetchRes.status}: ${await fetchRes.text()}`);
  const body = await fetchRes.json() as any;

  // Support both { data: [...] } and a top-level array
  const punches: any[] = Array.isArray(body) ? body : (body[dataField] ?? []);

  // ── Group punches by emp_id+date ──────────────────────────────────────────
  const byEmployee: Map<string, { ins: string[]; outs: string[] }> = new Map();
  for (const punch of punches) {
    const empId   = String(punch[empIdField] ?? '').trim();
    const rawTime = String(punch[timeField]  ?? '').trim();
    const ptype   = String(punch[typeField]  ?? '').trim().toUpperCase();
    if (!empId || !rawTime) continue;

    // Normalise time to HH:MM
    const dt = new Date(rawTime);
    const timeStr = isNaN(dt.getTime())
      ? rawTime.slice(11, 16)  // try "YYYY-MM-DD HH:MM:SS" substring
      : dt.toTimeString().slice(0, 5);

    if (!byEmployee.has(empId)) byEmployee.set(empId, { ins: [], outs: [] });
    const bucket = byEmployee.get(empId)!;
    if (ptype === inValue.toUpperCase())  bucket.ins.push(timeStr);
    if (ptype === outValue.toUpperCase()) bucket.outs.push(timeStr);
  }

  // ── Look up employees so we can map emp_id → our internal id ─────────────
  const empRows = await sql`SELECT id, employee_id FROM employees` as any[];
  const empMap: Map<string, string> = new Map(empRows.map(e => [e.employee_id, e.id]));

  const syncId = randomUUID();
  let recordsUpdated = 0;
  let recordsCreated = 0;

  for (const [empBioId, { ins, outs }] of byEmployee) {
    const internalId = empMap.get(empBioId);
    if (!internalId) continue; // unknown employee — skip

    const checkIn  = ins.length  ? ins.sort()[0]               : null; // earliest IN
    const checkOut = outs.length ? outs.sort().reverse()[0]     : null; // latest OUT
    const status   = deriveStatus(checkIn);
    const totalHours = checkIn && checkOut ? calcHours(checkIn, checkOut) : 0;

    // Snapshot existing record (before state)
    const existing = await sql`
      SELECT * FROM attendance_records WHERE employee_id = ${internalId} AND date = ${date}
    ` as any[];
    const hadRecord = existing.length > 0;
    const old = existing[0] ?? {};
    await sql`
      INSERT INTO attendance_sync_snapshot
        (sync_id, employee_id, date, had_record, status_before, check_in_before, check_out_before, total_hours_before)
      VALUES (${syncId}, ${internalId}, ${date}, ${hadRecord},
              ${old.status ?? null}, ${old.check_in ?? null}, ${old.check_out ?? null}, ${old.total_hours ?? null})
    `;

    // Upsert attendance record
    const result = await sql`
      INSERT INTO attendance_records
        (employee_id, date, check_in, check_out, status, total_hours, source, biometric_sync_id)
      VALUES (${internalId}, ${date}, ${checkIn}, ${checkOut}, ${status}, ${totalHours}, 'biometric', ${syncId})
      ON CONFLICT (employee_id, date) DO UPDATE SET
        check_in          = EXCLUDED.check_in,
        check_out         = EXCLUDED.check_out,
        status            = EXCLUDED.status,
        total_hours       = EXCLUDED.total_hours,
        source            = 'biometric',
        biometric_sync_id = ${syncId}
      RETURNING (xmax = 0) AS was_inserted
    ` as any[];

    if (result[0]?.was_inserted) recordsCreated++;
    else recordsUpdated++;
  }

  // ── Write sync log ────────────────────────────────────────────────────────
  await sql`
    INSERT INTO attendance_sync_log
      (sync_id, triggered, triggered_by, date_range, records_updated, records_created, status)
    VALUES (${syncId}, ${trigger}, ${triggeredBy ?? null}, ${date}, ${recordsUpdated}, ${recordsCreated}, 'success')
  `;

  return { sync_id: syncId, records_updated: recordsUpdated, records_created: recordsCreated, synced_at: new Date().toISOString(), date_range: date };
}

// ── Existing routes ──────────────────────────────────────────────────────────

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
      INSERT INTO attendance_records (employee_id, date, check_in, status, total_hours, source)
      VALUES (${employee_id}, ${today}, ${time}, ${status}, 0, 'clock_in')
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in = ${time}, status = ${status}, source = 'clock_in'
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

router.post('/mark', async (req, res) => {
  try {
    const { employee_id, date, status, check_in, check_out } = req.body;
    if (!employee_id || !date || !status) {
      return res.status(400).json({ error: 'employee_id, date and status are required' });
    }
    const totalHours = check_in && check_out ? calcHours(check_in, check_out) : 0;
    const rows = await sql`
      INSERT INTO attendance_records (employee_id, date, check_in, check_out, status, total_hours, source)
      VALUES (${employee_id}, ${date}, ${check_in ?? null}, ${check_out ?? null}, ${status}, ${totalHours}, 'manual')
      ON CONFLICT (employee_id, date) DO UPDATE SET
        check_in    = ${check_in ?? null},
        check_out   = ${check_out ?? null},
        status      = ${status},
        total_hours = ${totalHours},
        source      = 'manual'
      RETURNING *
    `;
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Biometric sync routes ────────────────────────────────────────────────────

// GET  /api/attendance/biometric-sync/history
router.get('/biometric-sync/history', async (_req, res) => {
  try {
    const rows = await sql`
      SELECT * FROM attendance_sync_log ORDER BY synced_at DESC LIMIT 20
    `;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/attendance/biometric-sync  — manual trigger
router.post('/biometric-sync', async (req, res) => {
  try {
    const { triggered_by, date } = req.body;
    const result = await runBiometricSync('manual', triggered_by, date);
    res.json(result);
  } catch (err: any) {
    console.error('[biometric sync]', err);
    // Log failed attempt
    try {
      await sql`
        INSERT INTO attendance_sync_log (sync_id, triggered, triggered_by, date_range, status, error_msg)
        VALUES (${randomUUID()}, 'manual', ${req.body.triggered_by ?? null}, ${req.body.date ?? new Date().toISOString().split('T')[0]}, 'failed', ${err.message})
      `;
    } catch {}
    res.status(500).json({ error: err.message ?? 'Biometric sync failed' });
  }
});

// POST /api/attendance/biometric-sync/rollback  — rollback last successful sync
router.post('/biometric-sync/rollback', async (_req, res) => {
  try {
    // Find the most recent rollback-able sync
    const logs = await sql`
      SELECT * FROM attendance_sync_log
      WHERE is_rolled_back = FALSE AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    ` as any[];

    if (!logs.length) return res.status(404).json({ error: 'No sync available to rollback' });
    const log = logs[0];
    const syncId = log.sync_id;

    // Restore snapshots
    const snapshots = await sql`
      SELECT * FROM attendance_sync_snapshot WHERE sync_id = ${syncId}
    ` as any[];

    for (const snap of snapshots) {
      if (!snap.had_record) {
        // Record was created by this sync — delete it
        await sql`
          DELETE FROM attendance_records
          WHERE employee_id = ${snap.employee_id} AND date = ${snap.date} AND biometric_sync_id = ${syncId}
        `;
      } else {
        // Record existed before — restore previous values
        await sql`
          UPDATE attendance_records SET
            check_in    = ${snap.check_in_before ?? null},
            check_out   = ${snap.check_out_before ?? null},
            status      = ${snap.status_before},
            total_hours = ${snap.total_hours_before ?? 0},
            source      = 'manual',
            biometric_sync_id = NULL
          WHERE employee_id = ${snap.employee_id} AND date = ${snap.date}
        `;
      }
    }

    // Mark sync log as rolled back
    await sql`
      UPDATE attendance_sync_log SET is_rolled_back = TRUE, rolled_back_at = NOW(), status = 'rolled_back'
      WHERE sync_id = ${syncId}
    `;

    res.json({ success: true, sync_id: syncId, records_restored: snapshots.length });
  } catch (err: any) {
    console.error('[biometric rollback]', err);
    res.status(500).json({ error: err.message ?? 'Rollback failed' });
  }
});

export default router;

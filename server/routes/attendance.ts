import { Router } from 'express';
import { sql } from '../db';
import { randomUUID } from 'crypto';

const router = Router();

// ── Boot-time migrations ────────────────────────────────────────────────────
;(async () => {
  try {
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id TEXT`;
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

// ── eTimeOffice helpers ──────────────────────────────────────────────────────

// eTimeOffice status codes → our attendance status
const ETIMEOFFICE_STATUS_MAP: Record<string, string> = {
  'P':   'present',
  'A':   'absent',
  'WO':  'weekend',
  'H':   'holiday',
  'LA':  'late',
  'PL':  'late',      // Partial Late
  'HD':  'half-day',
  'L':   'on_leave',
  'LV':  'on_leave',
  'CL':  'on_leave',  // Casual Leave
  'SL':  'on_leave',  // Sick Leave
  'EL':  'on_leave',  // Earned Leave
  'ML':  'on_leave',  // Medical Leave
  'OD':  'present',   // On Duty
  'WFH': 'present',   // Work From Home
  'CO':  'present',   // Compensatory Off worked
};

function parseEtTime(t: string | undefined | null): string | null {
  if (!t || t.trim() === '--:--' || t.trim() === '00:00') return null;
  return t.trim().slice(0, 5); // HH:MM
}

function parseEtWorkTime(wt: string | undefined | null): number {
  if (!wt || wt === '00:00' || wt === '--:--') return 0;
  const [h, m] = wt.split(':').map(Number);
  return Math.round((h + (m || 0) / 60) * 10) / 10;
}

function deriveStatus(etStatus: string, inTime: string | null): string {
  // If employee actually clocked in, infer from punch time
  if (inTime) {
    const hour = parseInt(inTime.split(':')[0], 10);
    return hour >= 10 ? 'late' : 'present';
  }
  return ETIMEOFFICE_STATUS_MAP[etStatus?.toUpperCase()] ?? 'absent';
}

// ── Core biometric sync (exported for auto-sync in server/index.ts) ──────────
export async function runBiometricSync(
  trigger: 'auto' | 'manual',
  triggeredBy?: string,
  fromDate?: string,  // YYYY-MM-DD, defaults to today
  toDate?: string     // YYYY-MM-DD, defaults to fromDate (single day)
): Promise<{ sync_id: string; records_updated: number; records_created: number; synced_at: string; date_range: string }> {
  const apiUrl = process.env.BIOMETRIC_API_URL;
  const apiKey = process.env.BIOMETRIC_API_KEY;
  if (!apiUrl) throw new Error('BIOMETRIC_API_URL is not configured in .env');

  const today = new Date().toISOString().split('T')[0];
  const from  = fromDate ?? today;
  const to    = toDate   ?? from;
  const dateRangeLabel = from === to ? from : `${from} to ${to}`;

  // eTimeOffice expects DD/MM/YYYY
  const toEt = (d: string) => { const [y, m, dy] = d.split('-'); return `${dy}/${m}/${y}`; };
  const url = `${apiUrl}?Empcode=ALL&FromDate=${toEt(from)}&ToDate=${toEt(to)}`;
  console.log(`[biometric] Fetching: ${url}`);

  const fetchRes = await fetch(url, {
    headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
  });

  if (!fetchRes.ok) {
    const text = await fetchRes.text().catch(() => '');
    throw new Error(`eTimeOffice API returned ${fetchRes.status}: ${text.slice(0, 200)}`);
  }

  const body = await fetchRes.json() as any;
  if (body.Error === true) throw new Error(`eTimeOffice error: ${body.Msg ?? 'Unknown'}`);

  const records: any[] = body.InOutPunchData ?? [];
  console.log(`[biometric] Got ${records.length} records for ${dateRangeLabel}`);

  // Match on biometric_id if set, otherwise fall back to employee_id
  const empRows = await sql`SELECT id, employee_id, biometric_id FROM employees` as any[];
  const empMap = new Map<string, string>();
  for (const e of empRows) {
    if (e.biometric_id) empMap.set(String(e.biometric_id).trim(), e.id);
    else empMap.set(String(e.employee_id).trim(), e.id);
  }

  const syncId = randomUUID();
  let recordsUpdated = 0;
  let recordsCreated = 0;

  for (const rec of records) {
    const empCode = String(rec.Empcode ?? '').trim();
    if (!empCode) continue;

    const internalId = empMap.get(empCode);
    if (!internalId) continue;

    // Parse record's date from DateString (DD/MM/YYYY) → YYYY-MM-DD
    const rawDs = String(rec.DateString ?? '').trim();
    let recDate = today;
    if (rawDs.includes('/')) {
      const [rdd, rmm, ryyyy] = rawDs.split('/');
      recDate = `${ryyyy}-${rmm}-${rdd}`;
    }

    const inTime     = parseEtTime(rec.INTime);
    const outTime    = parseEtTime(rec.OUTTime);
    const status     = deriveStatus(rec.Status ?? 'A', inTime);
    const totalHours = rec.WorkTime ? parseEtWorkTime(rec.WorkTime) : (inTime && outTime ? (() => {
      const [ih, im] = inTime.split(':').map(Number);
      const [oh, om] = outTime.split(':').map(Number);
      return Math.round(((oh * 60 + om) - (ih * 60 + im)) / 6) / 10;
    })() : 0);

    // Skip weekends/holidays with no clock-in
    if ((status === 'weekend' || status === 'holiday') && !inTime) continue;

    // Snapshot pre-sync state for rollback
    const existing = await sql`
      SELECT * FROM attendance_records WHERE employee_id = ${internalId} AND date = ${recDate}
    ` as any[];
    const hadRecord = existing.length > 0;
    const old = existing[0] ?? {};

    await sql`
      INSERT INTO attendance_sync_snapshot
        (sync_id, employee_id, date, had_record, status_before, check_in_before, check_out_before, total_hours_before)
      VALUES (${syncId}, ${internalId}, ${recDate}, ${hadRecord},
              ${old.status ?? null}, ${old.check_in ?? null}, ${old.check_out ?? null}, ${old.total_hours ?? null})
    `;

    const result = await sql`
      INSERT INTO attendance_records
        (employee_id, date, check_in, check_out, status, total_hours, source, biometric_sync_id)
      VALUES (${internalId}, ${recDate}, ${inTime}, ${outTime}, ${status}, ${totalHours}, 'biometric', ${syncId})
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

  await sql`
    INSERT INTO attendance_sync_log
      (sync_id, triggered, triggered_by, date_range, records_updated, records_created, status)
    VALUES (${syncId}, ${trigger}, ${triggeredBy ?? null}, ${dateRangeLabel}, ${recordsUpdated}, ${recordsCreated}, 'success')
  `;

  console.log(`[biometric] Sync ${syncId} done — updated: ${recordsUpdated}, created: ${recordsCreated}`);
  return { sync_id: syncId, records_updated: recordsUpdated, records_created: recordsCreated, synced_at: new Date().toISOString(), date_range: dateRangeLabel };
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
    const totalHours = check_in && check_out
      ? Math.round(((new Date(`1970-01-01T${check_out}`) as any) - (new Date(`1970-01-01T${check_in}`) as any)) / 360000) / 10
      : 0;
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

router.get('/biometric-sync/history', async (_req, res) => {
  try {
    const rows = await sql`SELECT * FROM attendance_sync_log ORDER BY synced_at DESC LIMIT 20`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/biometric-sync', async (req, res) => {
  try {
    const { triggered_by, from_date, to_date } = req.body;
    const result = await runBiometricSync('manual', triggered_by, from_date, to_date);
    res.json(result);
  } catch (err: any) {
    console.error('[biometric sync]', err);
    try {
      await sql`
        INSERT INTO attendance_sync_log (sync_id, triggered, triggered_by, date_range, status, error_msg)
        VALUES (${randomUUID()}, 'manual', ${req.body.triggered_by ?? null},
                ${req.body.from_date ?? new Date().toISOString().split('T')[0]}, 'failed', ${err.message})
      `;
    } catch {}
    res.status(500).json({ error: err.message ?? 'Biometric sync failed' });
  }
});

router.post('/biometric-sync/rollback', async (_req, res) => {
  try {
    const logs = await sql`
      SELECT * FROM attendance_sync_log
      WHERE is_rolled_back = FALSE AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    ` as any[];

    if (!logs.length) return res.status(404).json({ error: 'No sync available to rollback' });
    const { sync_id } = logs[0];

    const snapshots = await sql`
      SELECT * FROM attendance_sync_snapshot WHERE sync_id = ${sync_id}
    ` as any[];

    for (const snap of snapshots) {
      if (!snap.had_record) {
        await sql`DELETE FROM attendance_records WHERE employee_id = ${snap.employee_id} AND date = ${snap.date} AND biometric_sync_id = ${sync_id}`;
      } else {
        await sql`
          UPDATE attendance_records SET
            check_in          = ${snap.check_in_before ?? null},
            check_out         = ${snap.check_out_before ?? null},
            status            = ${snap.status_before},
            total_hours       = ${snap.total_hours_before ?? 0},
            source            = 'manual',
            biometric_sync_id = NULL
          WHERE employee_id = ${snap.employee_id} AND date = ${snap.date}
        `;
      }
    }

    await sql`
      UPDATE attendance_sync_log SET is_rolled_back = TRUE, rolled_back_at = NOW(), status = 'rolled_back'
      WHERE sync_id = ${sync_id}
    `;

    res.json({ success: true, sync_id, records_restored: snapshots.length });
  } catch (err: any) {
    console.error('[biometric rollback]', err);
    res.status(500).json({ error: err.message ?? 'Rollback failed' });
  }
});

export default router;

import { Router } from 'express';
import { sql } from '../db';
import { randomUUID } from 'crypto';

const router = Router();

// ── Boot-time migrations ────────────────────────────────────────────────────
;(async () => {
  try {
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id TEXT`;
    await sql`ALTER TABLE employees ADD COLUMN IF NOT EXISTS shift TEXT DEFAULT 'day'`;
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
    // One-time cleanup: remove any attendance records that fell on Sat (DOW=6) or Sun (DOW=0)
    // These were created by old biometric syncs / leave marking before the weekend fix.
    await sql`
      DELETE FROM attendance_records
      WHERE EXTRACT(DOW FROM date) IN (0, 6)
    `.catch(() => {});
  } catch (e) { console.error('[attendance migration]', e); }
})();

// Returns true if a "YYYY-MM-DD" date falls on Saturday (6) or Sunday (0)
function isWeekend(dateStr: string): boolean {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}

// ── Date normalisation ───────────────────────────────────────────────────────
// Neon returns DATE columns as UTC timestamps ("2026-04-09T18:30:00.000Z")
// representing IST midnight. Adding +5:30 converts back to the correct IST date.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function neonDateToStr(d: string): string {
  if (!d) return '';
  if (!d.includes('T')) return d.slice(0, 10);
  return new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function normDate(row: any): any {
  if (!row) return row;
  const fix = (v: any) => {
    if (!v) return v;
    // Neon may return DATE as a Date object OR a "YYYY-MM-DDTHH:MM:SS.sssZ" string
    const s: string = v instanceof Date ? v.toISOString() : String(v);
    if (!s.includes('T')) return s.slice(0, 10);   // already "YYYY-MM-DD"
    return neonDateToStr(s);                         // convert IST-offset UTC to correct date
  };
  return { ...row, date: fix(row.date) };
}

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

// Shift definitions — loaded from DB (config_shifts), cached with 60s TTL
let _shiftCache: Record<string, { start: string; end: string; lateAfter: string }> | null = null;
let _shiftCacheTs = 0;
async function getShiftConfig(): Promise<Record<string, { start: string; end: string; lateAfter: string }>> {
  if (_shiftCache && Date.now() - _shiftCacheTs < 60_000) return _shiftCache;
  try {
    const rows = await sql`SELECT id, start_time, end_time, late_after FROM config_shifts`;
    const cfg: Record<string, { start: string; end: string; lateAfter: string }> = {};
    for (const r of rows as any[]) cfg[r.id] = { start: r.start_time, end: r.end_time, lateAfter: r.late_after };
    _shiftCache = cfg;
    _shiftCacheTs = Date.now();
    return cfg;
  } catch {
    // fallback: Late if punch-in > 1 hour after shift start
    return { day: { start: '09:00', end: '18:00', lateAfter: '10:00' }, night: { start: '18:30', end: '03:30', lateAfter: '19:30' } };
  }
}

function isLateForShiftCfg(inTime: string, cfg: { lateAfter: string }): boolean {
  const [lh, lm] = cfg.lateAfter.split(':').map(Number);
  const [ch, cm] = inTime.split(':').map(Number);
  return ch > lh || (ch === lh && cm > lm);
}

// Sync fallback (uses cached value or hardcoded default)
function isLateForShift(inTime: string, shift: string): boolean {
  const cfg = _shiftCache?.[shift] ?? { lateAfter: '10:00' };
  return isLateForShiftCfg(inTime, cfg);
}

function deriveStatus(etStatus: string, inTime: string | null, shift = 'day'): string {
  if (inTime) return isLateForShift(inTime, shift) ? 'late' : 'present';
  return ETIMEOFFICE_STATUS_MAP[etStatus?.toUpperCase()] ?? 'absent';
}

// ── Core biometric sync (exported for auto-sync in server/index.ts) ──────────
export async function runBiometricSync(
  trigger: 'auto' | 'manual',
  triggeredBy?: string,
  fromDate?: string,  // YYYY-MM-DD, defaults to today
  toDate?: string     // YYYY-MM-DD, defaults to fromDate (single day)
): Promise<{ sync_id: string; records_updated: number; records_created: number; synced_at: string; date_range: string }> {
  // eTimeOffice endpoint — hardcoded as fallback so it works even if env var missing
  const apiUrl = process.env.BIOMETRIC_API_URL ?? 'https://api.etimeoffice.com/api/DownloadInOutPunchData';
  const apiKey = process.env.BIOMETRIC_API_KEY ?? 'ZGlnaXRhbF9sZWFwOmRpZ2l0YWxsZWFwOkQhZyF0YWxAMSo6dHJ1ZQ==';

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

  // Match on biometric_id if set, otherwise fall back to employee_id; also load shift
  const empRows = await sql`SELECT id, employee_id, biometric_id, shift FROM employees` as any[];
  const empMap   = new Map<string, string>();   // bioKey → internal id
  const shiftMap = new Map<string, string>();   // internal id → shift
  for (const e of empRows) {
    const key = e.biometric_id ? String(e.biometric_id).trim() : String(e.employee_id).trim();
    empMap.set(key, e.id);
    shiftMap.set(e.id, e.shift ?? 'day');
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
    const empShift   = shiftMap.get(internalId) ?? 'day';
    const status     = deriveStatus(rec.Status ?? 'A', inTime, empShift);
    const totalHours = rec.WorkTime ? parseEtWorkTime(rec.WorkTime) : (inTime && outTime ? (() => {
      const [ih, im] = inTime.split(':').map(Number);
      const [oh, om] = outTime.split(':').map(Number);
      return Math.round(((oh * 60 + om) - (ih * 60 + im)) / 6) / 10;
    })() : 0);

    // Saturdays and Sundays are never working days — skip entirely
    if (isWeekend(recDate)) continue;
    // Skip holidays with no clock-in
    if (status === 'holiday' && !inTime) continue;
    // Preserve approved WFH days — don't let biometric override them
    const wfhRows = await sql`
      SELECT id FROM wfh_requests WHERE employee_id=${internalId} AND date::date=${recDate}::date AND status='approved'
    `.catch(() => []);
    if ((wfhRows as any[]).length > 0) continue;

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
    // Strip any weekend records before sending to client (safety net)
    const filtered = (rows as any[]).map(normDate).filter(r => !isWeekend(r.date));
    res.json(filtered);
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
    if (isWeekend(today)) return res.status(400).json({ error: 'Weekends are non-working days' });
    const time = now.toTimeString().slice(0, 5); // HH:MM
    const empRow = await sql`SELECT shift FROM employees WHERE id = ${employee_id}` as any[];
    const shift = empRow[0]?.shift ?? 'day';
    const shiftCfg = await getShiftConfig();
    const status = isLateForShiftCfg(time, shiftCfg[shift] ?? { lateAfter: '09:00' }) ? 'late' : 'present';
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
    // Only update if check_in exists — prevents NULL total_hours
    const rows = await sql`
      UPDATE attendance_records SET check_out = ${time},
        total_hours = ROUND(EXTRACT(EPOCH FROM (${time}::time - check_in::time)) / 3600, 1)
      WHERE employee_id = ${employee_id} AND date = ${today} AND check_in IS NOT NULL
      RETURNING *
    `;
    if (!rows.length) return res.status(400).json({ error: 'No clock-in record found for today' });
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

export default router;

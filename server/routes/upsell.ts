import { Router } from 'express';
import { sql } from '../db';
import { notifyAdminsAndHR, notifyEmployeeUser } from '../lib/notify';

const router = Router();

// ── Boot migration ────────────────────────────────────────────────────────────
;(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS upsell_requests (
        id                TEXT PRIMARY KEY,
        employee_id       TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name     TEXT,
        client_name       TEXT NOT NULL,
        service_description TEXT NOT NULL,
        deal_value        NUMERIC,
        requested_amount  NUMERIC,
        notes             TEXT,
        status            TEXT NOT NULL DEFAULT 'pending',
        reviewed_by       TEXT,
        reviewed_at       TIMESTAMPTZ,
        rejection_reason  TEXT,
        approved_amount   NUMERIC,
        payment_note      TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    // Drop NOT NULL from requested_amount on existing tables (employees no longer set this)
    await sql`ALTER TABLE upsell_requests ALTER COLUMN requested_amount DROP NOT NULL`.catch(()=>{});
  } catch (e) { console.error('[upsell migration]', e); }
})();

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { employee_id } = req.query;
    const rows = employee_id
      ? await sql`SELECT * FROM upsell_requests WHERE employee_id = ${employee_id as string} ORDER BY created_at DESC`
      : await sql`SELECT * FROM upsell_requests ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', async (req, res) => {
  try {
    const { employee_id, employee_name, client_name, service_description, deal_value, notes } = req.body;
    if (!employee_id || !client_name?.trim() || !service_description?.trim()) {
      return res.status(400).json({ error: 'employee_id, client_name, service_description are required' });
    }
    const id = `ups_${Date.now()}`;
    const rows = await sql`
      INSERT INTO upsell_requests
        (id, employee_id, employee_name, client_name, service_description, deal_value, notes)
      VALUES (${id}, ${employee_id}, ${employee_name ?? null}, ${client_name.trim()},
              ${service_description.trim()}, ${deal_value ?? null}, ${notes?.trim() ?? null})
      RETURNING *
    `;
    notifyAdminsAndHR('upsell_submitted', 'Upsell Incentive Request',
      `${employee_name ?? 'An employee'} reported an upsell for "${client_name.trim()}"${deal_value ? ` — Deal: ₹${Number(deal_value).toLocaleString('en-IN')}` : ''}. Set their incentive amount.`
    ).catch(() => {});
    res.status(201).json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status, reviewed_by, rejection_reason, approved_amount, payment_note } = req.body;
    if (!['approved','rejected','paid'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    if (status === 'approved' && (!approved_amount || Number(approved_amount) <= 0))
      return res.status(400).json({ error: 'approved_amount is required and must be greater than 0' });
    // Validate state transition
    const current = await sql`SELECT status FROM upsell_requests WHERE id = ${req.params.id}`;
    if (!current.length) return res.status(404).json({ error: 'Not found' });
    const currentStatus = (current[0] as any).status;
    if (currentStatus === 'paid') return res.status(400).json({ error: 'Paid requests cannot be changed' });
    if (currentStatus === 'approved' && status === 'approved') return res.status(400).json({ error: 'Already approved' });
    const rows = await sql`
      UPDATE upsell_requests SET
        status            = ${status},
        reviewed_by       = ${reviewed_by ?? null},
        reviewed_at       = NOW(),
        rejection_reason  = ${status === 'rejected' ? (rejection_reason ?? null) : null},
        approved_amount   = ${approved_amount ?? null},
        payment_note      = ${payment_note ?? null}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const req2 = rows[0] as any;
    if (status === 'approved') {
      notifyEmployeeUser(req2.employee_id, 'upsell_approved',
        'Incentive Request Approved 🎉',
        `Your upsell request for "${req2.client_name}" has been approved! Incentive: ₹${Number(approved_amount).toLocaleString('en-IN')}.`
      ).catch(() => {});
    } else if (status === 'rejected') {
      notifyEmployeeUser(req2.employee_id, 'upsell_rejected',
        'Incentive Request Not Approved',
        `Your upsell request for "${req2.client_name}" was not approved.${rejection_reason ? ` Reason: ${rejection_reason}` : ''}`
      ).catch(() => {});
    } else if (status === 'paid') {
      notifyEmployeeUser(req2.employee_id, 'upsell_paid',
        'Incentive Payment Processed 💰',
        `Your incentive of ₹${Number(req2.approved_amount).toLocaleString('en-IN')} for "${req2.client_name}" has been paid.${payment_note ? ` Note: ${payment_note}` : ''}`
      ).catch(() => {});
    }
    res.json(req2);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

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
        deal_value        NUMERIC,                   -- total upsell deal size
        requested_amount  NUMERIC NOT NULL,           -- commission/incentive asked
        notes             TEXT,
        status            TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|paid
        reviewed_by       TEXT,
        reviewed_at       TIMESTAMPTZ,
        rejection_reason  TEXT,
        approved_amount   NUMERIC,                   -- HR may approve a different amount
        payment_note      TEXT,
        created_at        TIMESTAMPTZ DEFAULT NOW()
      )
    `;
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
    const { employee_id, employee_name, client_name, service_description, deal_value, requested_amount, notes } = req.body;
    if (!employee_id || !client_name?.trim() || !service_description?.trim() || !requested_amount) {
      return res.status(400).json({ error: 'employee_id, client_name, service_description, requested_amount are required' });
    }
    const id = `ups_${Date.now()}`;
    const rows = await sql`
      INSERT INTO upsell_requests
        (id, employee_id, employee_name, client_name, service_description, deal_value, requested_amount, notes)
      VALUES (${id}, ${employee_id}, ${employee_name ?? null}, ${client_name.trim()},
              ${service_description.trim()}, ${deal_value ?? null}, ${requested_amount}, ${notes?.trim() ?? null})
      RETURNING *
    `;
    // Notify HR/Admin
    notifyAdminsAndHR('upsell_submitted',
      'Upsell Incentive Request',
      `${employee_name ?? 'An employee'} submitted an upsell incentive request for client "${client_name.trim()}" — ₹${Number(requested_amount).toLocaleString('en-IN')}.`
    ).catch(() => {});
    res.status(201).json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status, reviewed_by, rejection_reason, approved_amount, payment_note } = req.body;
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

    // Notify employee of the decision
    if (status === 'approved') {
      const amt = approved_amount ?? req2.requested_amount;
      notifyEmployeeUser(req2.employee_id, 'upsell_approved',
        'Incentive Request Approved 🎉',
        `Your upsell incentive request for "${req2.client_name}" has been approved! Amount: ₹${Number(amt).toLocaleString('en-IN')}.`
      ).catch(() => {});
    } else if (status === 'rejected') {
      notifyEmployeeUser(req2.employee_id, 'upsell_rejected',
        'Incentive Request Not Approved',
        `Your upsell request for "${req2.client_name}" was not approved.${rejection_reason ? ` Reason: ${rejection_reason}` : ''}`
      ).catch(() => {});
    } else if (status === 'paid') {
      notifyEmployeeUser(req2.employee_id, 'upsell_paid',
        'Incentive Payment Processed 💰',
        `Your incentive for "${req2.client_name}" has been paid.${payment_note ? ` Note: ${payment_note}` : ''}`
      ).catch(() => {});
    }
    res.json(req2);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

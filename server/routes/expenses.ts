import { Router } from 'express';
import { sql } from '../db';
import { notifyAdminsAndHR, notifyEmployeeUser } from '../lib/notify';

const router = Router();

const CATEGORIES = ['Travel', 'Food & Meals', 'Equipment', 'Software', 'Marketing', 'Training', 'Other'];

;(async () => {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS expense_requests (
        id               TEXT PRIMARY KEY,
        employee_id      TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        employee_name    TEXT,
        category         TEXT NOT NULL,
        description      TEXT NOT NULL,
        amount           NUMERIC NOT NULL,
        receipt_note     TEXT,
        expense_date     DATE,
        status           TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|paid
        reviewed_by      TEXT,
        reviewed_at      TIMESTAMPTZ,
        rejection_reason TEXT,
        approved_amount  NUMERIC,
        payment_note     TEXT,
        created_at       TIMESTAMPTZ DEFAULT NOW()
      )
    `;
  } catch (e) { console.error('[expenses migration]', e); }
})();

router.get('/categories', (_req, res) => res.json(CATEGORIES));

router.get('/', async (req, res) => {
  try {
    const { employee_id } = req.query;
    const rows = employee_id
      ? await sql`SELECT * FROM expense_requests WHERE employee_id = ${employee_id as string} ORDER BY created_at DESC`
      : await sql`SELECT * FROM expense_requests ORDER BY created_at DESC`;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.post('/', async (req, res) => {
  try {
    const { employee_id, employee_name, category, description, amount, receipt_note, expense_date } = req.body;
    if (!employee_id || !category || !description?.trim() || !amount)
      return res.status(400).json({ error: 'category, description, amount are required' });
    if (Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });
    if (expense_date && expense_date > new Date().toISOString().slice(0, 10))
      return res.status(400).json({ error: 'Expense date cannot be in the future' });
    const id = `exp_${Date.now()}`;
    const rows = await sql`
      INSERT INTO expense_requests
        (id, employee_id, employee_name, category, description, amount, receipt_note, expense_date)
      VALUES (${id}, ${employee_id}, ${employee_name ?? null}, ${category},
              ${description.trim()}, ${amount}, ${receipt_note?.trim() ?? null}, ${expense_date ?? null})
      RETURNING *
    `;
    notifyAdminsAndHR('expense_submitted', 'Expense Claim Submitted',
      `${employee_name ?? 'An employee'} submitted a ${category} expense of ₹${Number(amount).toLocaleString('en-IN')}.`
    ).catch(() => {});
    res.status(201).json(rows[0]);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { status, reviewed_by, rejection_reason, approved_amount, payment_note } = req.body;
    if (!['approved','rejected','paid'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    if (approved_amount !== undefined && approved_amount !== null && Number(approved_amount) <= 0)
      return res.status(400).json({ error: 'Approved amount must be greater than 0' });
    // Validate state transition
    const current = await sql`SELECT status, amount FROM expense_requests WHERE id = ${req.params.id}`;
    if (!current.length) return res.status(404).json({ error: 'Not found' });
    const cur = current[0] as any;
    if (cur.status === 'paid') return res.status(400).json({ error: 'Paid expenses cannot be changed' });
    if (cur.status === 'rejected' && status === 'paid') return res.status(400).json({ error: 'Cannot pay a rejected expense' });
    if (cur.status === 'approved' && status === 'approved') return res.status(400).json({ error: 'Already approved' });
    const rows = await sql`
      UPDATE expense_requests SET
        status           = ${status},
        reviewed_by      = ${reviewed_by ?? null},
        reviewed_at      = NOW(),
        rejection_reason = ${status === 'rejected' ? (rejection_reason ?? null) : null},
        approved_amount  = ${approved_amount ?? null},
        payment_note     = ${payment_note ?? null}
      WHERE id = ${req.params.id} RETURNING *
    `;
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const exp = rows[0] as any;
    const displayAmt = approved_amount ?? exp.amount;
    if (status === 'approved') {
      notifyEmployeeUser(exp.employee_id, 'expense_approved', 'Expense Approved ✅',
        `Your ${exp.category} expense of ₹${Number(displayAmt).toLocaleString('en-IN')} has been approved.`
      ).catch(() => {});
    } else if (status === 'rejected') {
      notifyEmployeeUser(exp.employee_id, 'expense_rejected', 'Expense Not Approved',
        `Your ${exp.category} expense was not approved.${rejection_reason ? ` Reason: ${rejection_reason}` : ''}`
      ).catch(() => {});
    } else if (status === 'paid') {
      notifyEmployeeUser(exp.employee_id, 'expense_paid', 'Expense Reimbursed 💸',
        `Your ${exp.category} expense of ₹${Number(exp.approved_amount ?? exp.amount).toLocaleString('en-IN')} has been reimbursed.${payment_note ? ` Note: ${payment_note}` : ''}`
      ).catch(() => {});
    }
    res.json(exp);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;

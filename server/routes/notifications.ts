import { Router } from 'express';
import { sql } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const rows = await sql`
      SELECT * FROM notifications WHERE user_id = ${user_id as string}
      ORDER BY created_at DESC LIMIT 50
    `;
    res.json(rows);
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const rows = await sql`
      UPDATE notifications SET is_read = TRUE WHERE id = ${req.params.id} RETURNING *
    `;
    res.json(rows[0] ?? { success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/read-all', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    await sql`UPDATE notifications SET is_read = TRUE WHERE user_id = ${user_id as string} AND is_read = FALSE`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await sql`DELETE FROM notifications WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Server error' }); }
});

export default router;

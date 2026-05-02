import { Router } from 'express';
import { sql } from '../db';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const rows = await sql`SELECT id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at FROM app_users ORDER BY name`;
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { employee_id_ref, name, email, password, role, department, designation, avatar } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'Required fields missing' });

    const existing = await sql`SELECT id FROM app_users WHERE LOWER(email) = LOWER(${email})`;
    if (existing.length) return res.status(409).json({ error: 'A user with this email already exists.' });

    const id = `u_${Date.now()}`;
    const avatarStr = avatar || name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
    const rows = await sql`
      INSERT INTO app_users (id, employee_id_ref, name, email, password, role, department, designation, avatar, active)
      VALUES (${id}, ${employee_id_ref ?? null}, ${name}, ${email}, ${password}, ${role}, ${department}, ${designation}, ${avatarStr}, true)
      RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at
    `;
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, email, password, role, department, designation, avatar, active } = req.body;
    const rows = await sql`
      UPDATE app_users SET
        name = ${name}, email = ${email}, password = ${password}, role = ${role},
        department = ${department}, designation = ${designation}, avatar = ${avatar}, active = ${active}
      WHERE id = ${req.params.id}
      RETURNING id, employee_id_ref, name, email, role, department, designation, avatar, active, created_at
    `;
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/active', async (req, res) => {
  try {
    const { active } = req.body;
    const rows = await sql`UPDATE app_users SET active = ${active} WHERE id = ${req.params.id} RETURNING id, active`;
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Change password — verifies current password before updating
router.patch('/:id/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    // Verify current password
    const rows = await sql`SELECT id FROM app_users WHERE id = ${req.params.id} AND password = ${current_password}` as any[];
    if (!rows.length) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    await sql`UPDATE app_users SET password = ${new_password} WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await sql`DELETE FROM app_users WHERE id = ${req.params.id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

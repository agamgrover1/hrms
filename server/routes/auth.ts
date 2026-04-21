import { Router } from 'express';
import { sql } from '../db';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const rows = await sql`
      SELECT * FROM app_users WHERE LOWER(email) = LOWER(${email}) AND password = ${password} LIMIT 1
    `;
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });
    const user = rows[0];
    if (!user.active) return res.status(403).json({ error: 'Your account has been deactivated. Contact HR.' });

    // Never send password to client
    const { password: _pw, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

import { Router } from 'express';
import { sql } from '../db';
import bcrypt from 'bcryptjs';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Fetch by email only — compare password separately (supports hashed + legacy plain-text)
    const rows = await sql`SELECT * FROM app_users WHERE LOWER(email) = LOWER(${email}) LIMIT 1`;
    if (!rows.length) return res.status(401).json({ error: 'Invalid email or password.' });

    const user = rows[0] as any;
    if (!user.active) return res.status(403).json({ error: 'Your account has been deactivated. Contact HR.' });

    // bcrypt hash starts with $2a$ or $2b$; plain-text passwords don't
    const isHashed = typeof user.password === 'string' && user.password.startsWith('$2');
    const valid = isHashed
      ? await bcrypt.compare(password, user.password)
      : user.password === password;

    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

    // Auto-upgrade plain-text password to bcrypt on successful login
    if (!isHashed) {
      const hashed = await bcrypt.hash(password, 10);
      await sql`UPDATE app_users SET password = ${hashed} WHERE id = ${user.id}`.catch(() => {});
    }

    const { password: _pw, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;

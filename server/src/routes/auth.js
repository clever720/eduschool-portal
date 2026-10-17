const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { pool } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();
const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

router.get('/me', (req, res) => {
  if (!req.session?.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;
    const result = await pool.query(
      `SELECT u.id, u.school_id, u.full_name, u.email, u.password_hash, u.role, u.active, s.name AS school_name
       FROM users u JOIN schools s ON s.id=u.school_id WHERE u.email=LOWER($1)`, [email.trim()]
    );
    const user = result.rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
    if (!user || !valid || !user.active) return res.status(401).json({ error: 'Email or password is incorrect.' });
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, schoolId: user.school_id, name: user.full_name, email: user.email, role: user.role, schoolName: user.school_name };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ user: req.session.user });
      });
    });
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('educore.sid', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.status(204).end();
  });
});
module.exports = router;

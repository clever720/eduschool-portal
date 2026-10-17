
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200)
});

const parentSignupSchema = z.object({
  schoolId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200),
  studentAdmissionNumber: z.string().trim().min(1).max(40)
});

const studentSignupSchema = z.object({
  schoolId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200),
  admissionNumber: z.string().trim().min(1).max(40),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many registration attempts. Please try again later.'
  }
});

router.get('/schools', async (_req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name FROM schools ORDER BY name LIMIT 200'
    );
    res.json({ schools: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/me', (req, res) => {
  if (!req.session?.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;

    const result = await pool.query(
      `SELECT u.id, u.school_id, u.full_name, u.email,
              u.password_hash, u.role, u.active,
              s.name AS school_name
       FROM users u
       JOIN schools s ON s.id = u.school_id
       WHERE u.email = LOWER($1)
       LIMIT 2`,
      [email.trim()]
    );

    // Email addresses are expected to be unique within each school.
    // If the same email exists at multiple schools, require a school-specific
    // login design rather than silently selecting an arbitrary account.
    const user = result.rows.length === 1 ? result.rows[0] : null;

    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!user || !valid || !user.active) {
      return res.status(401).json({
        error: 'Email or password is incorrect, or the account is awaiting approval.'
      });
    }

    req.session.regenerate((err) => {
      if (err) return next(err);

      req.session.user = {
        id: user.id,
        schoolId: user.school_id,
        name: user.full_name,
        email: user.email,
        role: user.role,
        schoolName: user.school_name
      };

      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ user: req.session.user });
      });
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/signup/parent',
  signupLimiter,
  validate(parentSignupSchema),
  async (req, res, next) => {
    const client = await pool.connect();

    try {
      const b = req.validatedBody;
      const email = b.email.trim().toLowerCase();

      await client.query('BEGIN');

      const school = await client.query(
        'SELECT id FROM schools WHERE id = $1',
        [b.schoolId]
      );

      if (!school.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Please choose a valid school.'
        });
      }

      const hash = await bcrypt.hash(b.password, 12);

      const created = await client.query(
        `INSERT INTO users
           (school_id, full_name, email, password_hash, role, active)
         VALUES ($1, $2, $3, $4, 'parent', FALSE)
         RETURNING id`,
        [b.schoolId, b.fullName.trim(), email, hash]
      );

      const parentUserId = created.rows[0].id;

      // Create an unverified link only when the admission number and stored
      // parent email match. An administrator must verify it before access.
      await client.query(
        `INSERT INTO parent_student_links
           (parent_user_id, student_id, school_id, verified_at)
         SELECT $1, st.id, st.school_id, NULL
         FROM students st
         WHERE st.school_id = $2
           AND st.admission_number = $3
           AND LOWER(COALESCE(st.parent_email, '')) = $4
         ON CONFLICT (parent_user_id, student_id) DO NOTHING`,
        [
          parentUserId,
          b.schoolId,
          b.studentAdmissionNumber.trim(),
          email
        ]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message:
          'Registration received. Your school must verify your account and child link before access is granted.'
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'An account with that email already exists at this school.'
        });
      }
      next(err);
    } finally {
      client.release();
    }
  }
);

router.post(
  '/signup/student',
  signupLimiter,
  validate(studentSignupSchema),
  async (req, res, next) => {
    const client = await pool.connect();

    try {
      const b = req.validatedBody;
      const email = b.email.trim().toLowerCase();

      await client.query('BEGIN');

      const school = await client.query(
        'SELECT id FROM schools WHERE id = $1',
        [b.schoolId]
      );

      if (!school.rowCount) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Please choose a valid school.'
        });
      }

      const hash = await bcrypt.hash(b.password, 12);

      const created = await client.query(
        `INSERT INTO users
           (school_id, full_name, email, password_hash, role, active)
         VALUES ($1, $2, $3, $4, 'student', FALSE)
         RETURNING id`,
        [b.schoolId, b.fullName.trim(), email, hash]
      );

      const studentUserId = created.rows[0].id;

      // Link only when the admission number and date of birth match.
      // The account remains inactive until the school approves it.
      await client.query(
        `INSERT INTO student_accounts (user_id, student_id, school_id)
         SELECT $1, st.id, st.school_id
         FROM students st
         WHERE st.school_id = $2
           AND st.admission_number = $3
           AND st.date_of_birth = $4::date
         ON CONFLICT DO NOTHING`,
        [
          studentUserId,
          b.schoolId,
          b.admissionNumber.trim(),
          b.dateOfBirth
        ]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message:
          'Registration received. Your school must verify your student account before access is granted.'
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'An account with that email already exists at this school.'
        });
      }
      next(err);
    } finally {
      client.release();
    }
  }
);

router.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);

    res.clearCookie('educore.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });

    res.status(204).end();
  });
});

module.exports = router;

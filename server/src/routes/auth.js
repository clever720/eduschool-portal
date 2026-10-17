
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth, allowRoles } = require('../middleware/auth');

const router = express.Router();

/* -------------------- VALIDATION SCHEMAS -------------------- */

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

const approveParentSchema = z.object({
  studentId: z.string().uuid()
});

const approveStudentSchema = z.object({
  studentId: z.string().uuid()
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

/* -------------------- SCHOOL LIST -------------------- */

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

/* -------------------- CURRENT SESSION -------------------- */

router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.json({ user: null });
  }

  res.json({ user: req.session.user });
});

/* -------------------- LOGIN -------------------- */

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.validatedBody;

    const result = await pool.query(
      `SELECT u.id, u.school_id, u.full_name, u.email,
              u.password_hash, u.role, u.active,
              s.name AS school_name
       FROM users u
       JOIN schools s ON s.id = u.school_id
       WHERE LOWER(u.email) = LOWER($1)
       LIMIT 2`,
      [email.trim()]
    );

    // Emails must resolve to exactly one account.
    // If the same email exists at multiple schools, login needs a
    // school-specific selection rather than choosing an arbitrary account.
    const user = result.rows.length === 1 ? result.rows[0] : null;

    const valid = user
      ? await bcrypt.compare(password, user.password_hash)
      : false;

    if (!user || !valid || !user.active) {
      return res.status(401).json({
        error:
          'Email or password is incorrect, or the account is awaiting approval.'
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

/* -------------------- PARENT REGISTRATION -------------------- */

router.post(
  '/signup/parent',
  signupLimiter,
  validate(parentSignupSchema),
  async (req, res, next) => {
    let client;

    try {
      client = await pool.connect();

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

      // Create a pending parent-child link only when the school's
      // existing student record contains the same parent email.
      // The school must verify the relationship before access is granted.
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
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      if (err.code === '23505') {
        return res.status(409).json({
          error: 'An account with that email already exists at this school.'
        });
      }

      next(err);
    } finally {
      if (client) client.release();
    }
  }
);

/* -------------------- STUDENT REGISTRATION -------------------- */

router.post(
  '/signup/student',
  signupLimiter,
  validate(studentSignupSchema),
  async (req, res, next) => {
    let client;

    try {
      client = await pool.connect();

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

      // Match the student's admission number and date of birth.
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
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      if (err.code === '23505') {
        return res.status(409).json({
          error: 'An account with that email already exists at this school.'
        });
      }

      next(err);
    } finally {
      if (client) client.release();
    }
  }
);

/* -------------------- ADMIN: APPROVE PARENT -------------------- */

router.post(
  '/approve/parent/:userId',
  requireAuth,
  allowRoles('admin'),
  validate(approveParentSchema),
  async (req, res, next) => {
    const userIdCheck = z.string().uuid().safeParse(req.params.userId);

    if (!userIdCheck.success) {
      return res.status(400).json({
        error: 'Invalid parent account ID.'
      });
    }

    let client;

    try {
      client = await pool.connect();

      const parentUserId = userIdCheck.data;
      const { studentId } = req.validatedBody;
      const schoolId = req.session.user.schoolId;

      await client.query('BEGIN');

      const parent = await client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND school_id = $2
           AND role = 'parent'
         FOR UPDATE`,
        [parentUserId, schoolId]
      );

      if (!parent.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Parent account not found in your school.'
        });
      }

      const student = await client.query(
        `SELECT id
         FROM students
         WHERE id = $1
           AND school_id = $2
           AND active = TRUE`,
        [studentId, schoolId]
      );

      if (!student.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Active student record not found in your school.'
        });
      }

      // IMPORTANT:
      // The administrator must independently verify the parent-child
      // relationship before calling this approval endpoint.
      await client.query(
        `INSERT INTO parent_student_links
           (parent_user_id, student_id, school_id, verified_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (parent_user_id, student_id)
         DO UPDATE SET verified_at = NOW()`,
        [parentUserId, studentId, schoolId]
      );

      await client.query(
        `UPDATE users
         SET active = TRUE
         WHERE id = $1
           AND school_id = $2
           AND role = 'parent'`,
        [parentUserId, schoolId]
      );

      await client.query('COMMIT');

      res.json({
        message: 'Parent account approved and student link verified.'
      });
    } catch (err) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      next(err);
    } finally {
      if (client) client.release();
    }
  }
);

/* -------------------- ADMIN: APPROVE STUDENT -------------------- */

router.post(
  '/approve/student/:userId',
  requireAuth,
  allowRoles('admin'),
  validate(approveStudentSchema),
  async (req, res, next) => {
    const userIdCheck = z.string().uuid().safeParse(req.params.userId);

    if (!userIdCheck.success) {
      return res.status(400).json({
        error: 'Invalid student account ID.'
      });
    }

    let client;

    try {
      client = await pool.connect();

      const studentUserId = userIdCheck.data;
      const { studentId } = req.validatedBody;
      const schoolId = req.session.user.schoolId;

      await client.query('BEGIN');

      const account = await client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND school_id = $2
           AND role = 'student'
         FOR UPDATE`,
        [studentUserId, schoolId]
      );

      if (!account.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Student account not found in your school.'
        });
      }

      const student = await client.query(
        `SELECT id
         FROM students
         WHERE id = $1
           AND school_id = $2
           AND active = TRUE`,
        [studentId, schoolId]
      );

      if (!student.rowCount) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Active student record not found in your school.'
        });
      }

      // Never overwrite a student-record association silently.
      await client.query(
        `INSERT INTO student_accounts (user_id, student_id, school_id)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [studentUserId, studentId, schoolId]
      );

      const verifiedLink = await client.query(
        `SELECT user_id
         FROM student_accounts
         WHERE user_id = $1
           AND student_id = $2
           AND school_id = $3`,
        [studentUserId, studentId, schoolId]
      );

      if (!verifiedLink.rowCount) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error:
            'This student record is already linked to another account, or this account is linked to a different record. Review the records before approving.'
        });
      }

      await client.query(
        `UPDATE users
         SET active = TRUE
         WHERE id = $1
           AND school_id = $2
           AND role = 'student'`,
        [studentUserId, schoolId]
      );

      await client.query('COMMIT');

      res.json({
        message: 'Student account approved and student record linked.'
      });
    } catch (err) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      next(err);
    } finally {
      if (client) client.release();
    }
  }
);

/* -------------------- LOGOUT -------------------- */

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

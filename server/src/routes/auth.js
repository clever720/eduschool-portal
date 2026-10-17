
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { pool } = require('../db');
const { validate } = require('../middleware/validate');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { audit } = require('../middleware/audit');

const router = express.Router();

/* -------------------- VALIDATION -------------------- */

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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts. Please try again later.'
  }
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
  } catch (error) {
    next(error);
  }
});

/* -------------------- CURRENT SESSION -------------------- */

router.get('/me', (req, res) => {
  res.json({
    user: req.session?.user || null
  });
});

/* -------------------- LOGIN -------------------- */

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  async (req, res, next) => {
    try {
      const { email, password } = req.validatedBody;

      const result = await pool.query(
        `SELECT
           u.id,
           u.school_id,
           u.full_name,
           u.email,
           u.password_hash,
           u.role,
           u.active,
           s.name AS school_name
         FROM users u
         JOIN schools s ON s.id = u.school_id
         WHERE LOWER(u.email) = LOWER($1)
         LIMIT 2`,
        [email.trim()]
      );

      // Never select an arbitrary account if an email exists
      // at more than one school.
      const user =
        result.rows.length === 1 ? result.rows[0] : null;

      const passwordMatches = user
        ? await bcrypt.compare(password, user.password_hash)
        : false;

      if (!user || !passwordMatches || !user.active) {
        return res.status(401).json({
          error:
            'Email or password is incorrect, or the account is awaiting approval.'
        });
      }

      req.session.regenerate((error) => {
        if (error) return next(error);

        req.session.user = {
          id: user.id,
          schoolId: user.school_id,
          name: user.full_name,
          email: user.email,
          role: user.role,
          schoolName: user.school_name
        };

        req.session.save((saveError) => {
          if (saveError) return next(saveError);

          res.json({ user: req.session.user });
        });
      });
    } catch (error) {
      next(error);
    }
  }
);

/* -------------------- PARENT REGISTRATION -------------------- */

router.post(
  '/signup/parent',
  signupLimiter,
  validate(parentSignupSchema),
  async (req, res, next) => {
    let client;

    try {
      client = await pool.connect();

      const body = req.validatedBody;
      const email = body.email.trim().toLowerCase();

      await client.query('BEGIN');

      const school = await client.query(
        'SELECT id FROM schools WHERE id = $1',
        [body.schoolId]
      );

      if (!school.rowCount) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error: 'Please choose a valid school.'
        });
      }

      // A parent can register only when the admission number and
      // email match an existing school record.
      const matchingStudent = await client.query(
        `SELECT id
         FROM students
         WHERE school_id = $1
           AND admission_number = $2
           AND LOWER(COALESCE(parent_email, '')) = $3
           AND active = TRUE
         LIMIT 1`,
        [
          body.schoolId,
          body.studentAdmissionNumber.trim(),
          email
        ]
      );

      if (!matchingStudent.rowCount) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error:
            'The details could not be matched to an active student record. Please contact your school to check its records.'
        });
      }

      const passwordHash = await bcrypt.hash(body.password, 12);

      const created = await client.query(
        `INSERT INTO users (
           school_id,
           full_name,
           email,
           password_hash,
           role,
           active
         )
         VALUES ($1, $2, $3, $4, 'parent', FALSE)
         RETURNING id`,
        [
          body.schoolId,
          body.fullName.trim(),
          email,
          passwordHash
        ]
      );

      const parentUserId = created.rows[0].id;
      const studentId = matchingStudent.rows[0].id;

      await client.query(
        `INSERT INTO parent_student_links (
           parent_user_id,
           student_id,
           school_id,
           verified_at
         )
         VALUES ($1, $2, $3, NULL)`,
        [parentUserId, studentId, body.schoolId]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message:
          'Registration received. Your school must verify your account and child relationship before access is granted.'
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      if (error.code === '23505') {
        return res.status(409).json({
          error:
            'An account with that email already exists at this school.'
        });
      }

      next(error);
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

      const body = req.validatedBody;
      const email = body.email.trim().toLowerCase();

      await client.query('BEGIN');

      const school = await client.query(
        'SELECT id FROM schools WHERE id = $1',
        [body.schoolId]
      );

      if (!school.rowCount) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error: 'Please choose a valid school.'
        });
      }

      // Verify the student's school record before creating an account.
      const matchingStudent = await client.query(
        `SELECT id
         FROM students
         WHERE school_id = $1
           AND admission_number = $2
           AND date_of_birth = $3::date
           AND active = TRUE
         LIMIT 1`,
        [
          body.schoolId,
          body.admissionNumber.trim(),
          body.dateOfBirth
        ]
      );

      if (!matchingStudent.rowCount) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error:
            'The details could not be matched to an active student record. Please contact your school to check its records.'
        });
      }

      const passwordHash = await bcrypt.hash(body.password, 12);

      const created = await client.query(
        `INSERT INTO users (
           school_id,
           full_name,
           email,
           password_hash,
           role,
           active
         )
         VALUES ($1, $2, $3, $4, 'student', FALSE)
         RETURNING id`,
        [
          body.schoolId,
          body.fullName.trim(),
          email,
          passwordHash
        ]
      );

      const studentUserId = created.rows[0].id;
      const studentId = matchingStudent.rows[0].id;

      // The link is created while the account is inactive.
      // It cannot be used to sign in until an admin approves it.
      await client.query(
        `INSERT INTO student_accounts (
           user_id,
           student_id,
           school_id
         )
         VALUES ($1, $2, $3)`,
        [studentUserId, studentId, body.schoolId]
      );

      await client.query('COMMIT');

      res.status(201).json({
        message:
          'Registration received. Your school must approve your student account before access is granted.'
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      if (error.code === '23505') {
        return res.status(409).json({
          error:
            'An account with that email already exists, or this student record is already linked to an account.'
        });
      }

      next(error);
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

      // Only approve the exact relationship created as pending
      // during registration. Do not create arbitrary parent links.
      const pendingLink = await client.query(
        `SELECT psl.student_id
         FROM parent_student_links psl
         JOIN students s
           ON s.id = psl.student_id
          AND s.school_id = psl.school_id
         WHERE psl.parent_user_id = $1
           AND psl.student_id = $2
           AND psl.school_id = $3
           AND psl.verified_at IS NULL
           AND s.active = TRUE
         FOR UPDATE OF psl`,
        [parentUserId, studentId, schoolId]
      );

      if (!pendingLink.rowCount) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error:
            'No matching pending parent-child link was found. Verify the school records before approving.'
        });
      }

      await client.query(
        `UPDATE parent_student_links
         SET verified_at = NOW()
         WHERE parent_user_id = $1
           AND student_id = $2
           AND school_id = $3
           AND verified_at IS NULL`,
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

      await audit(
        req,
        'parent.approve',
        'user',
        parentUserId
      );

      res.json({
        message: 'Parent account approved and child link verified.'
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      next(error);
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
        `SELECT id, active
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

      if (account.rows[0].active) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error: 'This student account is already active.'
        });
      }

      // Verify the exact link made during registration.
      // Never attach an account to an arbitrary student record here.
      const verifiedLink = await client.query(
        `SELECT sa.user_id
         FROM student_accounts sa
         JOIN students s
           ON s.id = sa.student_id
          AND s.school_id = sa.school_id
         WHERE sa.user_id = $1
           AND sa.student_id = $2
           AND sa.school_id = $3
           AND s.active = TRUE
         FOR UPDATE OF sa`,
        [studentUserId, studentId, schoolId]
      );

      if (!verifiedLink.rowCount) {
        await client.query('ROLLBACK');

        return res.status(409).json({
          error:
            'No matching student registration link was found. Verify the student record before approving.'
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

      await audit(
        req,
        'student.approve',
        'user',
        studentUserId
      );

      res.json({
        message: 'Student account approved and record verified.'
      });
    } catch (error) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }

      next(error);
    } finally {
      if (client) client.release();
    }
  }
);

/* -------------------- LOGOUT -------------------- */

router.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);

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

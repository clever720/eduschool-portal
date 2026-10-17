
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { audit } = require('../middleware/audit');

const router = express.Router();

router.use(requireAuth);

/* -------------------- VIEW RESULTS -------------------- */

router.get('/', async (req, res, next) => {
  try {
    const user = req.session.user;

    if (!['admin', 'teacher', 'parent', 'student'].includes(user.role)) {
      return res.status(403).json({
        error: 'You do not have permission to view student results.'
      });
    }

    const q = await pool.query(
      `SELECT
         r.id,
         r.student_id,
         s.full_name,
         s.admission_number,
         s.class_name,
         r.subject,
         r.term,
         r.academic_session,
         r.score,
         r.created_at
       FROM results r
       JOIN students s
         ON s.id = r.student_id
        AND s.school_id = r.school_id
       WHERE r.school_id = $1
         AND (
           $2 IN ('admin', 'teacher')

           OR (
             $2 = 'parent'
             AND EXISTS (
               SELECT 1
               FROM parent_student_links psl
               WHERE psl.parent_user_id = $3
                 AND psl.student_id = s.id
                 AND psl.school_id = s.school_id
                 AND psl.verified_at IS NOT NULL
             )
           )

           OR (
             $2 = 'student'
             AND EXISTS (
               SELECT 1
               FROM student_accounts sa
               WHERE sa.user_id = $3
                 AND sa.student_id = s.id
                 AND sa.school_id = s.school_id
             )
           )
         )
       ORDER BY r.created_at DESC
       LIMIT 1000`,
      [user.schoolId, user.role, user.id]
    );

    res.json({ results: q.rows });
  } catch (e) {
    next(e);
  }
});

/* -------------------- VALIDATE RESULT INPUT -------------------- */

const schema = z.object({
  student_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(100),
  term: z.enum(['First Term', 'Second Term', 'Third Term']),
  academic_session: z.string().trim().min(4).max(40),
  score: z.coerce.number().min(0).max(100)
});

const uuidSchema = z.string().uuid();

function validateResultId(req, res, next) {
  const parsed = uuidSchema.safeParse(req.params.id);

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid result ID.'
    });
  }

  req.params.id = parsed.data;
  next();
}

/* -------------------- ADD RESULT -------------------- */

router.post(
  '/',
  allowRoles('admin', 'teacher'),
  validate(schema),
  async (req, res, next) => {
    try {
      const b = req.validatedBody;

      const student = await pool.query(
        `SELECT id
         FROM students
         WHERE id = $1
           AND school_id = $2
           AND active = TRUE`,
        [b.student_id, req.session.user.schoolId]
      );

      if (!student.rowCount) {
        return res.status(400).json({
          error: 'Active student not found in this school.'
        });
      }

      const q = await pool.query(
        `INSERT INTO results (
           school_id,
           student_id,
           subject,
           term,
           academic_session,
           score,
           entered_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          req.session.user.schoolId,
          b.student_id,
          b.subject,
          b.term,
          b.academic_session,
          b.score,
          req.session.user.id
        ]
      );

      await audit(
        req,
        'result.create',
        'result',
        q.rows[0].id
      );

      res.status(201).json({ result: q.rows[0] });
    } catch (e) {
      next(e);
    }
  }
);

/* -------------------- DELETE RESULT -------------------- */

router.delete(
  '/:id',
  validateResultId,
  allowRoles('admin'),
  async (req, res, next) => {
    try {
      const q = await pool.query(
        `DELETE FROM results
         WHERE id = $1
           AND school_id = $2
         RETURNING id`,
        [
          req.params.id,
          req.session.user.schoolId
        ]
      );

      if (!q.rowCount) {
        return res.status(404).json({
          error: 'Result not found.'
        });
      }

      await audit(
        req,
        'result.delete',
        'result',
        q.rows[0].id
      );

      res.status(204).end();
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;

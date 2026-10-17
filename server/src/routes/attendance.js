
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { audit } = require('../middleware/audit');

const router = express.Router();

router.use(requireAuth);

/* -------------------- VIEW ATTENDANCE -------------------- */

router.get('/', async (req, res, next) => {
  try {
    const user = req.session.user;
    const date = String(
      req.query.date || new Date().toISOString().slice(0, 10)
    );

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date.' });
    }

    // Attendance is available only to these roles.
    if (!['admin', 'teacher', 'parent', 'student'].includes(user.role)) {
      return res.status(403).json({
        error: 'You do not have permission to view attendance.'
      });
    }

    const q = await pool.query(
      `SELECT
         a.id,
         s.id AS student_id,
         s.admission_number,
         s.full_name,
         s.class_name,
         a.attendance_date,
         a.status
       FROM students s
       LEFT JOIN attendance a
         ON a.student_id = s.id
        AND a.school_id = s.school_id
        AND a.attendance_date = $2
       WHERE s.school_id = $1
         AND s.active = TRUE
         AND (
           $3 IN ('admin', 'teacher')

           OR (
             $3 = 'parent'
             AND EXISTS (
               SELECT 1
               FROM parent_student_links psl
               WHERE psl.parent_user_id = $4
                 AND psl.student_id = s.id
                 AND psl.school_id = s.school_id
                 AND psl.verified_at IS NOT NULL
             )
           )

           OR (
             $3 = 'student'
             AND EXISTS (
               SELECT 1
               FROM student_accounts sa
               WHERE sa.user_id = $4
                 AND sa.student_id = s.id
                 AND sa.school_id = s.school_id
             )
           )
         )
       ORDER BY s.class_name, s.full_name`,
      [user.schoolId, date, user.role, user.id]
    );

    res.json({
      attendance: q.rows.map((r) => ({
        ...r,
        // Preserve the existing display behavior for records
        // that have not yet been marked.
        status: r.status || 'present',
        attendance_date: r.attendance_date || date
      }))
    });
  } catch (e) {
    next(e);
  }
});

/* -------------------- VALIDATE ATTENDANCE INPUT -------------------- */

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  records: z.array(
    z.object({
      student_id: z.string().uuid(),
      status: z.enum(['present', 'absent', 'late', 'excused'])
    })
  ).min(1).max(1000)
});

/* -------------------- MARK / SAVE ATTENDANCE -------------------- */

router.post(
  '/',
  allowRoles('admin', 'teacher'),
  validate(schema),
  async (req, res, next) => {
    let client;
    let transactionStarted = false;

    try {
      const { date, records } = req.validatedBody;

      // Prevent duplicate student entries in the same request.
      const studentIds = records.map((record) => record.student_id);

      if (new Set(studentIds).size !== studentIds.length) {
        return res.status(400).json({
          error: 'Each student can appear only once per attendance submission.'
        });
      }

      client = await pool.connect();

      await client.query('BEGIN');
      transactionStarted = true;

      for (const record of records) {
        const exists = await client.query(
          `SELECT id
           FROM students
           WHERE id = $1
             AND school_id = $2
             AND active = TRUE`,
          [record.student_id, req.session.user.schoolId]
        );

        if (!exists.rowCount) {
          const error = new Error(
            'One or more students are invalid or inactive in your school.'
          );
          error.status = 400;
          throw error;
        }

        await client.query(
          `INSERT INTO attendance (
             school_id,
             student_id,
             attendance_date,
             status,
             marked_by
           )
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (student_id, attendance_date)
           DO UPDATE SET
             status = EXCLUDED.status,
             marked_by = EXCLUDED.marked_by`,
          [
            req.session.user.schoolId,
            record.student_id,
            date,
            record.status,
            req.session.user.id
          ]
        );
      }

      await client.query('COMMIT');
      transactionStarted = false;

      await audit(req, 'attendance.save', 'attendance', null);

      res.json({ saved: records.length });
    } catch (e) {
      if (client && transactionStarted) {
        await client.query('ROLLBACK').catch(() => {});
      }

      if (e.status) {
        return res.status(e.status).json({ error: e.message });
      }

      next(e);
    } finally {
      if (client) client.release();
    }
  }
);

module.exports = router;


const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { audit } = require('../middleware/audit');

const router = express.Router();

router.use(requireAuth);

// View fees according to the signed-in user's role.
router.get(
  '/',
  allowRoles('admin', 'bursar', 'parent', 'student'),
  async (req, res, next) => {
    try {
      const user = req.session.user;
      let query;
      let params;

      if (user.role === 'parent') {
        query = `
          SELECT
            f.id,
            f.student_id,
            s.full_name,
            s.admission_number,
            s.class_name,
            f.description,
            f.amount_due,
            f.amount_paid,
            f.due_date,
            f.created_at
          FROM fees f
          JOIN students s
            ON s.id = f.student_id
           AND s.school_id = f.school_id
          JOIN parent_student_links psl
            ON psl.student_id = s.id
           AND psl.school_id = s.school_id
          WHERE f.school_id = $1
            AND psl.parent_user_id = $2
            AND psl.verified_at IS NOT NULL
          ORDER BY f.created_at DESC
          LIMIT 1000
        `;
        params = [user.schoolId, user.id];
      } else if (user.role === 'student') {
        query = `
          SELECT
            f.id,
            f.student_id,
            s.full_name,
            s.admission_number,
            s.class_name,
            f.description,
            f.amount_due,
            f.amount_paid,
            f.due_date,
            f.created_at
          FROM fees f
          JOIN students s
            ON s.id = f.student_id
           AND s.school_id = f.school_id
          JOIN student_accounts sa
            ON sa.student_id = s.id
           AND sa.school_id = s.school_id
          WHERE f.school_id = $1
            AND sa.user_id = $2
          ORDER BY f.created_at DESC
          LIMIT 1000
        `;
        params = [user.schoolId, user.id];
      } else {
        query = `
          SELECT
            f.id,
            f.student_id,
            s.full_name,
            s.admission_number,
            s.class_name,
            f.description,
            f.amount_due,
            f.amount_paid,
            f.due_date,
            f.created_at
          FROM fees f
          JOIN students s
            ON s.id = f.student_id
           AND s.school_id = f.school_id
          WHERE f.school_id = $1
          ORDER BY f.created_at DESC
          LIMIT 1000
        `;
        params = [user.schoolId];
      }

      const result = await pool.query(query, params);
      res.json({ fees: result.rows });
    } catch (error) {
      next(error);
    }
  }
);

const feeSchema = z.object({
  student_id: z.string().uuid(),
  description: z.string().trim().min(1).max(160),
  amount_due: z.coerce.number().min(0).max(999999999),
  amount_paid: z.coerce.number().min(0).max(999999999),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal(''))
    .optional()
}).refine(
  (value) => value.amount_paid <= value.amount_due,
  {
    message: 'Amount paid cannot exceed amount due.',
    path: ['amount_paid']
  }
);

// Create a fee: admins and bursars only.
router.post(
  '/',
  allowRoles('admin', 'bursar'),
  validate(feeSchema),
  async (req, res, next) => {
    try {
      const body = req.validatedBody;

      const student = await pool.query(
        `SELECT id
         FROM students
         WHERE id = $1
           AND school_id = $2`,
        [body.student_id, req.session.user.schoolId]
      );

      if (!student.rowCount) {
        return res.status(400).json({
          error: 'Student not found in this school.'
        });
      }

      const result = await pool.query(
        `INSERT INTO fees (
          school_id,
          student_id,
          description,
          amount_due,
          amount_paid,
          due_date,
          recorded_by
        )
        VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, $7)
        RETURNING *`,
        [
          req.session.user.schoolId,
          body.student_id,
          body.description,
          body.amount_due,
          body.amount_paid,
          body.due_date || '',
          req.session.user.id
        ]
      );

      await audit(req, 'fee.create', 'fee', result.rows[0].id);

      res.status(201).json({ fee: result.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

// Update a fee: admins and bursars only.
router.put(
  '/:id',
  allowRoles('admin', 'bursar'),
  validate(feeSchema),
  async (req, res, next) => {
    try {
      const body = req.validatedBody;

      if (!z.string().uuid().safeParse(req.params.id).success) {
        return res.status(400).json({
          error: 'Invalid fee record ID.'
        });
      }

      const student = await pool.query(
        `SELECT id
         FROM students
         WHERE id = $1
           AND school_id = $2`,
        [body.student_id, req.session.user.schoolId]
      );

      if (!student.rowCount) {
        return res.status(400).json({
          error: 'Student not found in this school.'
        });
      }

      const result = await pool.query(
        `UPDATE fees
         SET student_id = $1,
             description = $2,
             amount_due = $3,
             amount_paid = $4,
             due_date = NULLIF($5, '')::date,
             updated_at = NOW()
         WHERE id = $6
           AND school_id = $7
         RETURNING *`,
        [
          body.student_id,
          body.description,
          body.amount_due,
          body.amount_paid,
          body.due_date || '',
          req.params.id,
          req.session.user.schoolId
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Fee record not found.'
        });
      }

      await audit(req, 'fee.update', 'fee', result.rows[0].id);

      res.json({ fee: result.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

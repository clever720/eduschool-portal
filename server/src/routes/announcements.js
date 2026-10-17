
const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { audit } = require('../middleware/audit');

const router = express.Router();

router.use(requireAuth);

// All signed-in school users can read their school's announcements.
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, message, created_at
       FROM announcements
       WHERE school_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.session.user.schoolId]
    );

    res.json({ announcements: result.rows });
  } catch (error) {
    next(error);
  }
});

const announcementSchema = z.object({
  title: z.string().trim().min(2).max(180),
  message: z.string().trim().min(2).max(10000)
});

// Only school administrators can publish announcements.
router.post(
  '/',
  allowRoles('admin'),
  validate(announcementSchema),
  async (req, res, next) => {
    try {
      const { title, message } = req.validatedBody;

      const result = await pool.query(
        `INSERT INTO announcements (
          school_id,
          title,
          message,
          created_by
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, title, message, created_at`,
        [
          req.session.user.schoolId,
          title,
          message,
          req.session.user.id
        ]
      );

      await audit(
        req,
        'announcement.create',
        'announcement',
        result.rows[0].id
      );

      res.status(201).json({
        announcement: result.rows[0]
      });
    } catch (error) {
      next(error);
    }
  }
);

// Only school administrators can delete announcements.
router.delete(
  '/:id',
  allowRoles('admin'),
  async (req, res, next) => {
    try {
      if (!z.string().uuid().safeParse(req.params.id).success) {
        return res.status(400).json({
          error: 'Invalid announcement ID.'
        });
      }

      const result = await pool.query(
        `DELETE FROM announcements
         WHERE id = $1
           AND school_id = $2
         RETURNING id`,
        [
          req.params.id,
          req.session.user.schoolId
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: 'Announcement not found.'
        });
      }

      await audit(
        req,
        'announcement.delete',
        'announcement',
        result.rows[0].id
      );

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

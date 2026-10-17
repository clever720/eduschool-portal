const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { audit } = require('../middleware/audit');
const router = express.Router();

router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query('SELECT id,name,email,phone,address,academic_session,academic_term FROM schools WHERE id=$1', [req.session.user.schoolId]);
    res.json({ settings: r.rows[0] });
  } catch (e) { next(e); }
});
const settingsSchema = z.object({
  name: z.string().trim().min(2).max(160), email: z.string().trim().email().max(254).or(z.literal('')).optional(),
  phone: z.string().trim().max(40).optional(), address: z.string().trim().max(1000).optional(),
  academic_session: z.string().trim().min(4).max(40), academic_term: z.enum(['First Term','Second Term','Third Term'])
});
router.put('/settings', requireAuth, allowRoles('admin'), validate(settingsSchema), async (req, res, next) => {
  try {
    const b = req.validatedBody;
    const r = await pool.query(
      `UPDATE schools SET name=$1,email=NULLIF($2,''),phone=$3,address=$4,academic_session=$5,academic_term=$6,updated_at=NOW()
       WHERE id=$7 RETURNING id,name,email,phone,address,academic_session,academic_term`,
      [b.name,b.email || '',b.phone || '',b.address || '',b.academic_session,b.academic_term,req.session.user.schoolId]
    );
    await audit(req, 'school.settings.update', 'school', r.rows[0].id);
    res.json({ settings: r.rows[0] });
  } catch (e) { next(e); }
});
module.exports = router;

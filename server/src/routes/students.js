const express = require('express');
const { z } = require('zod');
const { pool } = require('../db');
const { requireAuth, allowRoles } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { audit } = require('../middleware/audit');
const router = express.Router();
router.use(requireAuth);
const schema = z.object({
  admission_number: z.string().trim().min(1).max(40), full_name: z.string().trim().min(2).max(160),
  class_name: z.string().trim().min(1).max(80), gender: z.enum(['Male','Female','Other','']).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
  parent_name: z.string().trim().max(160).optional(), parent_phone: z.string().trim().max(40).optional(),
  parent_email: z.string().trim().email().max(254).or(z.literal('')).optional()
});
router.get('/', async (req,res,next) => {
  try {
    const { search = '', className = '' } = req.query;
    const q = await pool.query(
      `SELECT id,admission_number,full_name,class_name,gender,date_of_birth,parent_name,parent_phone,parent_email,active,created_at
       FROM students WHERE school_id=$1 AND ($2='' OR full_name ILIKE '%'||$2||'%' OR admission_number ILIKE '%'||$2||'%')
       AND ($3='' OR class_name=$3) ORDER BY full_name LIMIT 500`,
      [req.session.user.schoolId, String(search).slice(0,100), String(className).slice(0,80)]
    ); res.json({ students:q.rows });
  } catch(e){next(e);}
});
router.post('/', allowRoles('admin','teacher'), validate(schema), async (req,res,next) => {
  try {
    const b=req.validatedBody;
    const q=await pool.query(
      `INSERT INTO students(school_id,admission_number,full_name,class_name,gender,date_of_birth,parent_name,parent_phone,parent_email)
       VALUES($1,$2,$3,$4,NULLIF($5,''),NULLIF($6,'')::date,$7,$8,NULLIF($9,''))
       RETURNING id,admission_number,full_name,class_name,gender,date_of_birth,parent_name,parent_phone,parent_email,active,created_at`,
      [req.session.user.schoolId,b.admission_number,b.full_name,b.class_name,b.gender||'',b.date_of_birth||'',b.parent_name||'',b.parent_phone||'',b.parent_email||'']
    ); await audit(req,'student.create','student',q.rows[0].id); res.status(201).json({student:q.rows[0]});
  } catch(e){ if(e.code==='23505') return res.status(409).json({error:'That admission number already exists.'}); next(e); }
});
router.put('/:id', allowRoles('admin','teacher'), validate(schema), async (req,res,next) => {
  try {
    const b=req.validatedBody;
    const q=await pool.query(
      `UPDATE students SET admission_number=$1,full_name=$2,class_name=$3,gender=NULLIF($4,''),date_of_birth=NULLIF($5,'')::date,parent_name=$6,parent_phone=$7,parent_email=NULLIF($8,''),updated_at=NOW()
       WHERE id=$9 AND school_id=$10 RETURNING id,admission_number,full_name,class_name,gender,date_of_birth,parent_name,parent_phone,parent_email,active,created_at`,
      [b.admission_number,b.full_name,b.class_name,b.gender||'',b.date_of_birth||'',b.parent_name||'',b.parent_phone||'',b.parent_email||'',req.params.id,req.session.user.schoolId]
    ); if(!q.rowCount) return res.status(404).json({error:'Student not found.'}); await audit(req,'student.update','student',q.rows[0].id); res.json({student:q.rows[0]});
  } catch(e){ if(e.code==='23505') return res.status(409).json({error:'That admission number already exists.'}); next(e); }
});
router.delete('/:id', allowRoles('admin'), async (req,res,next) => {
  try { const q=await pool.query('DELETE FROM students WHERE id=$1 AND school_id=$2 RETURNING id',[req.params.id,req.session.user.schoolId]); if(!q.rowCount) return res.status(404).json({error:'Student not found.'}); await audit(req,'student.delete','student',q.rows[0].id); res.status(204).end(); }
  catch(e){next(e);}
});
module.exports=router;

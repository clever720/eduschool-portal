const express=require('express');const {pool}=require('../db');const {requireAuth}=require('../middleware/auth');const router=express.Router();router.use(requireAuth);
router.get('/summary',async(req,res,next)=>{try{const schoolId=req.session.user.schoolId;const [students,teachers,results,attendance,fees,announcements]=await Promise.all([
pool.query('SELECT COUNT(*)::int AS count FROM students WHERE school_id=$1 AND active=TRUE',[schoolId]),
pool.query('SELECT COUNT(*)::int AS count FROM teachers WHERE school_id=$1',[schoolId]),
pool.query('SELECT COUNT(*)::int AS count FROM results WHERE school_id=$1',[schoolId]),
pool.query("SELECT COUNT(*) FILTER(WHERE status='present')::int AS present,COUNT(*) FILTER(WHERE status='absent')::int AS absent FROM attendance WHERE school_id=$1 AND attendance_date=CURRENT_DATE",[schoolId]),
pool.query('SELECT COALESCE(SUM(amount_due),0)::numeric AS due,COALESCE(SUM(amount_paid),0)::numeric AS paid FROM fees WHERE school_id=$1',[schoolId]),
pool.query('SELECT id,title,message,created_at FROM announcements WHERE school_id=$1 ORDER BY created_at DESC LIMIT 5',[schoolId])]);
res.json({summary:{students:students.rows[0].count,teachers:teachers.rows[0].count,results:results.rows[0].count,present:attendance.rows[0].present,absent:attendance.rows[0].absent,feesDue:Number(fees.rows[0].due),feesPaid:Number(fees.rows[0].paid),feesOutstanding:Number(fees.rows[0].due)-Number(fees.rows[0].paid),announcements:announcements.rows}});
}catch(e){next(e);}});module.exports=router;

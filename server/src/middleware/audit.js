const { pool } = require('../db');
async function audit(req, action, entityType = null, entityId = null) {
  const user = req.session?.user;
  if (!user) return;
  try {
    await pool.query(
      'INSERT INTO audit_logs(school_id,user_id,action,entity_type,entity_id,ip_address) VALUES($1,$2,$3,$4,$5,$6)',
      [user.schoolId, user.id, action, entityType, entityId, req.ip]
    );
  } catch (err) { console.error('Audit log failed:', err.message); }
}
module.exports = { audit };

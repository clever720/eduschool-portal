require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./db');

(async () => {
  const [, , schoolName, adminName, email, password] = process.argv;
  if (!schoolName || !adminName || !email || !password) {
    console.error('Usage: npm run admin:create -- "School Name" "Admin Name" admin@school.com "StrongPasswordHere"');
    process.exitCode = 1; await pool.end(); return;
  }
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exitCode = 1; await pool.end(); return;
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const school = await client.query(
        'INSERT INTO schools(name) VALUES($1) RETURNING id', [schoolName.trim()]
      );
      const hash = await bcrypt.hash(password, 12);
      await client.query(
        'INSERT INTO users(school_id, full_name, email, password_hash, role) VALUES($1,$2,LOWER($3),$4,$5)',
        [school.rows[0].id, adminName.trim(), email.trim(), hash, 'admin']
      );
      await client.query('COMMIT');
      console.log(`Created school and admin account for ${email.trim()}. Keep the password private.`);
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  } catch (err) {
    console.error('Could not create admin:', err.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();

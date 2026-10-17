require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('./db');
(async () => {
  try {
    const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('EduCore database schema created/updated successfully.');
  } catch (err) {
    console.error('Database initialization failed:', err.message);
    process.exitCode = 1;
  } finally { await pool.end(); }
})();

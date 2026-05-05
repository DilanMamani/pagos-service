const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.query('select now()')
  .then(res => console.log('DB conectada:', res.rows[0]))
  .catch(err => console.error('Error DB:', err.message));

module.exports = pool;
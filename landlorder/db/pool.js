// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// db/pool.js — PostgreSQL Connection Pool
//
// Creates ONE shared pool that all route files import and reuse.
// A pool manages multiple simultaneous DB connections efficiently —
// instead of opening/closing a connection on every request (slow),
// it maintains a group of idle connections ready to use instantly.
//
// Usage in any route file:
//   const pool = require('../db/pool');
//   const { rows } = await pool.query('SELECT * FROM landlords', []);
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { Pool } = require('pg');

// Pool reads DATABASE_URL from .env
// Railway sets this automatically when you add a Postgres service.
// Local format: postgresql://postgres:password@localhost:5432/landlorder
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  // SSL is required for Railway/Supabase hosted Postgres.
  // rejectUnauthorized: false allows self-signed certs (common on Railway).
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,                              // no SSL in local dev

  // Pool size settings
  max: 10,                               // max 10 simultaneous connections
  idleTimeoutMillis: 30000,             // close idle connections after 30s
  connectionTimeoutMillis: 2000,        // fail fast if can't connect in 2s
});

// Log when connections are acquired/released (dev only)
if (process.env.NODE_ENV !== 'production') {
  pool.on('connect', () => {
    console.log('DB: new client connected');
  });
}

// Log and handle unexpected pool errors
// Without this handler, pool errors crash the server
pool.on('error', (err) => {
  console.error('Unexpected DB pool error:', err.message);
});

// Test the connection on startup so you know immediately if DB is unreachable
pool.query('SELECT NOW()')
  .then(() => console.log('DB: connection established'))
  .catch(err => console.error('DB: connection failed —', err.message));

module.exports = pool;

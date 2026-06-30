// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// routes/auth.js — User Authentication + Quota
//
// Note: when using Supabase Auth, register/login are handled
// entirely by Supabase (frontend calls Supabase REST directly).
// These routes handle:
//   POST /api/auth/register — custom JWT fallback (optional)
//   POST /api/auth/login    — custom JWT fallback (optional)
//   GET  /api/users/me/quota — server-side usage quota check
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const router  = require('express').Router();
const pool    = require('../db/pool');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const auth    = require('../middleware/auth');

// ── POST /api/auth/register ───────────────────────────────────────
// Creates a new user with a hashed password and returns a JWT.
// Only needed if NOT using Supabase Auth.
// If using Supabase Auth, this route can be left in as a fallback.
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  // Server-side validation — never trust the frontend alone
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // Hash the password with bcrypt cost factor 12
    // Higher cost = more secure but slower. 12 is the standard.
    // bcrypt is one-way — you can never reverse it to get the password
    const hash = await bcrypt.hash(password, 12);

    // Insert the new user — RETURNING gives us the row without a second SELECT
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [email.toLowerCase().trim(), hash]
      // $1, $2 = parameterized — prevents SQL injection attacks
    );

    // Sign a JWT with the user's ID as the payload
    // This token is sent back and stored by the frontend
    const token = jwt.sign(
      { userId: rows[0].id },      // payload: data encoded in the token
      process.env.JWT_SECRET,      // secret: must match on every verify
      { expiresIn: '7d' }          // expiry: token stops working after 7 days
    );

    res.status(201).json({ token, user: rows[0] });
    // 201 = Created — a new resource was successfully created

  } catch (err) {
    // Postgres error code 23505 = unique constraint violation
    // Means this email already exists in the users table
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already in use' });
      // 409 = Conflict
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── POST /api/auth/login ──────────────────────────────────────────
// Verifies email + password and returns a JWT.
// Only needed if NOT using Supabase Auth.
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Look up the user by email
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    // Intentionally vague error — don't tell attackers if the email exists
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // bcrypt.compare hashes the submitted password and compares to stored hash
    // Returns true/false — cannot reverse the hash
    const valid = await bcrypt.compare(password, rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: rows[0].id, email: rows[0].email },
      // password_hash is NOT returned — only safe fields
    });

  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

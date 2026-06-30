// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// routes/users.js — User Quota + Profile
//
// GET /api/users/me/quota — returns server-side usage counts
//   Called by App.jsx on login to enforce the annual listing limit.
//   This is the authoritative check — client-side localStorage is
//   just UI feedback. The server always wins.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const router = require('express').Router();
const pool   = require('../db/pool');
const auth   = require('../middleware/auth');

// ── GET /api/users/me/quota ───────────────────────────────────────
// Returns the current user's usage counts for this calendar year.
// Frontend uses this to:
//   1. Show/hide the "+ Add" button (listing limit)
//   2. Show the server-verified count in the quota banner
//   3. Override client-side localStorage if they disagree
router.get('/me/quota', auth, async (req, res) => {
  try {
    // Count both event types in one query using conditional aggregation
    // This is faster than two separate COUNT queries
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'listing_added')    AS listings_this_year,
         COUNT(*) FILTER (WHERE event_type = 'review_submitted') AS reviews_this_year
       FROM usage_events
       WHERE user_id    = $1
         AND created_at >= date_trunc('year', NOW())`,
      // date_trunc('year', NOW()) = midnight on January 1st of current year
      [req.user.userId]
    );

    const quota = rows[0];
    const nextYear  = new Date(new Date().getFullYear() + 1, 0, 1);
    const daysLeft  = Math.ceil((nextYear - new Date()) / 864e5);

    res.json({
      listings_this_year:  parseInt(quota.listings_this_year),
      reviews_this_year:   parseInt(quota.reviews_this_year),
      listing_limit:       1,            // annual limit per user
      can_add_listing:     parseInt(quota.listings_this_year) < 1,
      days_until_reset:    daysLeft,
      resets_on:           nextYear.toISOString().split('T')[0],
    });

  } catch (err) {
    console.error('Quota error:', err.message);
    res.status(500).json({ error: 'Could not fetch quota' });
  }
});

// ── GET /api/users/me ─────────────────────────────────────────────
// Returns the current user's profile and subscription plan.
router.get('/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.email, u.created_at,
         s.plan_id, s.status,
         s.current_period_end,
         s.cancel_at_period_end,
         s.billing_period
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.user.userId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Me error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

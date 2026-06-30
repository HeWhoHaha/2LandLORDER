// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// routes/reviews.js — Review CRUD
//
// GET  /api/landlords/:id/reviews  — get reviews (public)
// POST /api/landlords/:id/reviews  — submit review (auth required)
// POST /api/reviews/:id/flag       — flag review (auth required)
// POST /api/reviews/:id/respond    — respond to review (Landlord Pro)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const router = require('express').Router();
const pool   = require('../db/pool');
const auth   = require('../middleware/auth');
const { requirePlan, requireReviewQuota } = require('../middleware/requirePlan');


// ── GET /api/landlords/:id/reviews ───────────────────────────────
// Returns all non-flagged reviews for a landlord, newest first.
// Hides reviewer email when anonymous = TRUE.
// Public — no auth required.
router.get('/landlords/:id/reviews', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         r.id,
         r.rating,
         r.text,
         r.communication,
         r.maintenance,
         r.fairness,
         r.anonymous,
         r.created_at,

         -- CASE WHEN = SQL conditional expression
         -- Hides the email when the reviewer chose anonymous posting
         CASE
           WHEN r.anonymous THEN NULL
           ELSE u.email
         END AS user_email,

         -- Include landlord's response if one exists
         rr.text       AS response_text,
         rr.created_at AS response_date

       FROM reviews r
       LEFT JOIN users u            ON r.user_id  = u.id
       -- LEFT JOIN = include the review even if user was deleted
       LEFT JOIN review_responses rr ON r.id      = rr.review_id

       WHERE r.landlord_id = $1
         AND r.flagged     = FALSE
       -- flagged = FALSE excludes reported reviews from public view

       ORDER BY r.created_at DESC`,
      // Newest reviews appear first
      [req.params.id]
    );

    res.json(rows);

  } catch (err) {
    console.error('Get reviews error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── POST /api/landlords/:id/reviews ──────────────────────────────
// Submits a new review for a landlord.
// Requires: auth + annual review quota check.
// Enforces: one review per user per landlord.
router.post('/landlords/:id/reviews', auth, requireReviewQuota, async (req, res) => {
  const { rating, text, communication, maintenance, fairness, anonymous } = req.body;

  // ── Server-side validation ────────────────────────────────────
  if (!rating || !text?.trim()) {
    return res.status(400).json({ error: 'Rating and review text are required' });
  }
  if (rating < 1 || rating > 5 || !Number.isInteger(Number(rating))) {
    return res.status(400).json({ error: 'Rating must be a whole number between 1 and 5' });
  }
  if (text.trim().length < 10) {
    return res.status(400).json({ error: 'Review must be at least 10 characters' });
  }
  if (text.trim().length > 2000) {
    return res.status(400).json({ error: 'Review cannot exceed 2000 characters' });
  }

  try {
    // ── One review per user per landlord ─────────────────────────
    // Check before inserting to give a clear error message
    // (the UNIQUE index also enforces this at the DB level)
    const existing = await pool.query(
      `SELECT id FROM reviews
       WHERE landlord_id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        error: 'You have already reviewed this landlord',
        // 409 = Conflict — resource already exists
      });
    }

    // ── Insert the review ─────────────────────────────────────────
    const { rows } = await pool.query(
      `INSERT INTO reviews
         (landlord_id, user_id, rating, text,
          communication, maintenance, fairness, anonymous)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.params.id,
        req.user.userId,
        // user_id comes from the verified JWT — can't be faked by client
        parseInt(rating),
        text.trim(),
        communication ? parseInt(communication) : null,
        maintenance   ? parseInt(maintenance)   : null,
        fairness      ? parseInt(fairness)      : null,
        anonymous !== false,  // default true if not explicitly set to false
      ]
    );

    // ── Record usage event for quota tracking ─────────────────────
    await pool.query(
      `INSERT INTO usage_events (user_id, event_type)
       VALUES ($1, 'review_submitted')`,
      [req.user.userId]
    );
    // The DB trigger fires automatically after INSERT on reviews
    // and recalculates avg_rating + review_count on the landlords table.
    // No manual update needed here.

    res.status(201).json(rows[0]);

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You have already reviewed this landlord' });
    }
    console.error('Submit review error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── POST /api/reviews/:id/flag ────────────────────────────────────
// Flags a review as inappropriate.
// Sets flagged = TRUE, which:
//   1. Hides it from GET /reviews (WHERE flagged = FALSE)
//   2. Triggers the DB trigger to recalculate avg_rating
// Requires: auth (any logged-in user can flag)
router.post('/reviews/:id/flag', auth, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE reviews
       SET flagged = TRUE
       WHERE id = $1`,
      [req.params.id]
      // rowCount tells us if any rows were actually updated
    );

    if (rowCount === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // The trigger fires here too — recalculates avg_rating
    // excluding the now-flagged review from the calculation

    res.json({ success: true, message: 'Review flagged and removed from public view' });

  } catch (err) {
    console.error('Flag review error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── POST /api/reviews/:id/respond ────────────────────────────────
// Landlord Pro: respond to a review on your claimed property.
// Requires: auth + can_respond feature + verified ownership.
router.post('/reviews/:id/respond', auth, requirePlan('can_respond'), async (req, res) => {
  const { text } = req.body;

  if (!text?.trim() || text.trim().length < 10) {
    return res.status(400).json({ error: 'Response must be at least 10 characters' });
  }
  if (text.trim().length > 1000) {
    return res.status(400).json({ error: 'Response cannot exceed 1000 characters' });
  }

  try {
    // Verify this user owns the landlord profile for this review
    // Must be verified = TRUE (admin confirmed ownership)
    const ownership = await pool.query(
      `SELECT lp.id
       FROM landlord_profiles lp
       JOIN reviews r ON r.landlord_id = lp.landlord_id
       WHERE r.id      = $1
         AND lp.user_id  = $2
         AND lp.verified = TRUE`,
      [req.params.id, req.user.userId]
    );

    if (!ownership.rows.length) {
      return res.status(403).json({
        error: 'You can only respond to reviews for your verified properties',
        // 403 = Forbidden — authenticated but not authorized
      });
    }

    // Upsert: insert response or update existing one
    // ON CONFLICT (review_id) = only one response per review
    const { rows } = await pool.query(
      `INSERT INTO review_responses (review_id, user_id, text)
       VALUES ($1, $2, $3)
       ON CONFLICT (review_id)
       DO UPDATE SET text = $3, updated_at = NOW()
       RETURNING *`,
      [req.params.id, req.user.userId, text.trim()]
    );

    res.status(201).json(rows[0]);

  } catch (err) {
    console.error('Respond to review error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

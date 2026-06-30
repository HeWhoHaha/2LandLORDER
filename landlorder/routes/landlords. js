// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// routes/landlords.js — Landlord CRUD
//
// GET  /api/landlords?search= — search landlords (public)
// GET  /api/landlords/:id     — get one landlord (public)
// POST /api/landlords         — add new landlord (auth required)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const router = require('express').Router();
const pool   = require('../db/pool');
const auth   = require('../middleware/auth');
const { requireListingQuota } = require('../middleware/requirePlan');


// ── GET /api/landlords?search= ────────────────────────────────────
// Returns up to 20 landlords matching the search term.
// Searches name, company, address, city, and state.
// Public endpoint — no auth required.
router.get('/', async (req, res) => {
  const { search = '', state, min_rating, max_rating, limit = 20, offset = 0 } = req.query;

  try {
    // Build WHERE clause dynamically based on query params
    const conditions = [];
    const params     = [];
    let   paramIndex = 1;

    // Full-text search across key columns using ILIKE (case-insensitive)
    // % = wildcard: %brooklyn% matches "Brooklyn", "Brooklyn Heights", etc.
    if (search.trim()) {
      conditions.push(`(
        name    ILIKE $${paramIndex}
        OR company ILIKE $${paramIndex}
        OR address ILIKE $${paramIndex}
        OR city    ILIKE $${paramIndex}
        OR state   ILIKE $${paramIndex}
      )`);
      params.push(`%${search.trim()}%`);
      paramIndex++;
    }

    // Optional state filter
    if (state) {
      conditions.push(`state ILIKE $${paramIndex}`);
      params.push(state);
      paramIndex++;
    }

    // Optional rating range filter
    if (min_rating) {
      conditions.push(`avg_rating >= $${paramIndex}`);
      params.push(parseFloat(min_rating));
      paramIndex++;
    }
    if (max_rating) {
      conditions.push(`avg_rating <= $${paramIndex}`);
      params.push(parseFloat(max_rating));
      paramIndex++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         id, name, company,
         address, city, state, zip, formatted_address,
         avg_rating, review_count,
         has_property_manager, landlord_in_state,
         created_at
       FROM landlords
       ${where}
       ORDER BY
         review_count DESC,     -- most-reviewed appear first
         avg_rating   DESC      -- tie-break by rating
       LIMIT  $${paramIndex}
       OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    res.json(rows);

  } catch (err) {
    console.error('Landlord search error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── GET /api/landlords/:id ────────────────────────────────────────
// Returns a single landlord by UUID.
// Called when opening the detail view in the frontend.
// Public — no auth required.
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         id, name, company,
         address, city, state, zip, country,
         place_id, lat, lng, formatted_address,
         avg_rating, review_count,
         has_property_manager, property_manager_name,
         landlord_in_state, created_at
       FROM landlords
       WHERE id = $1`,
      [req.params.id]
      // req.params.id = the :id segment from the URL
      // e.g. GET /api/landlords/3f2b1a-... → req.params.id = "3f2b1a-..."
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Landlord not found' });
      // 404 = Not Found
    }

    res.json(rows[0]);

  } catch (err) {
    console.error('Landlord get error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── POST /api/landlords ───────────────────────────────────────────
// Creates a new landlord listing.
// Requires: auth + annual listing quota check (1 per year per user).
// Uses normalized Google Places data for the address fields.
router.post('/', auth, requireListingQuota, async (req, res) => {
  const {
    name, company,
    address, city, state, zip, country,
    place_id, lat, lng, formatted_address,
    has_property_manager, property_manager_name,
    landlord_in_state,
  } = req.body;

  // Server-side validation
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Landlord name is required' });
  }
  if (!address || !address.trim()) {
    return res.status(400).json({ error: 'Address is required' });
  }

  try {
    // Insert the new landlord
    const { rows } = await pool.query(
      `INSERT INTO landlords
         (name, company, address, city, state, zip, country,
          place_id, lat, lng, formatted_address,
          has_property_manager, property_manager_name,
          landlord_in_state, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        name.trim(),
        company?.trim() || null,
        address.trim(),
        city?.trim()    || null,
        state?.trim()   || null,
        zip?.trim()     || null,
        country         || 'US',
        place_id        || null,
        lat             ?? null,
        lng             ?? null,
        formatted_address || null,
        has_property_manager  || null,
        property_manager_name?.trim() || null,
        landlord_in_state     || null,
        req.user.userId,        // track who added this listing
      ]
    );

    // Record the usage event for annual quota tracking
    // This is what the server checks for the 1-per-year limit
    await pool.query(
      `INSERT INTO usage_events (user_id, event_type)
       VALUES ($1, 'listing_added')`,
      [req.user.userId]
    );

    res.status(201).json(rows[0]);
    // 201 = Created

  } catch (err) {
    // 23505 = unique constraint violation (place_id already exists)
    if (err.code === '23505') {
      return res.status(409).json({
        error: 'A landlord with this address already exists',
      });
    }
    console.error('Landlord create error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── POST /api/landlords/:id/claim ─────────────────────────────────
// Landlord Pro: claim ownership of a landlord listing.
// Requires: auth + Landlord Pro plan (can_claim feature).
const { requirePlan } = require('../middleware/requirePlan');

router.post('/:id/claim', auth, requirePlan('can_claim'), async (req, res) => {
  try {
    // Check if already claimed
    const existing = await pool.query(
      'SELECT user_id FROM landlord_profiles WHERE landlord_id = $1',
      [req.params.id]
    );
    if (existing.rows.length) {
      return res.status(409).json({ error: 'This profile has already been claimed' });
    }

    // Verify the landlord exists
    const landlord = await pool.query(
      'SELECT id FROM landlords WHERE id = $1',
      [req.params.id]
    );
    if (!landlord.rows.length) {
      return res.status(404).json({ error: 'Landlord not found' });
    }

    const { rows } = await pool.query(
      `INSERT INTO landlord_profiles (landlord_id, user_id, verified)
       VALUES ($1, $2, FALSE)
       RETURNING *`,
      [req.params.id, req.user.userId]
      // verified = FALSE until an admin reviews and confirms the claim
    );

    res.status(201).json({
      ...rows[0],
      message: 'Claim submitted. Verification usually takes 1–3 business days.',
    });

  } catch (err) {
    console.error('Claim error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── GET /api/landlords/:id/analytics ─────────────────────────────
// Landlord Pro: rating trends and category breakdown for a profile.
// Requires: auth + has_analytics feature + ownership of the profile.
router.get('/:id/analytics', auth, requirePlan('has_analytics'), async (req, res) => {
  try {
    // Verify ownership
    const own = await pool.query(
      `SELECT id FROM landlord_profiles
       WHERE landlord_id = $1 AND user_id = $2`,
      [req.params.id, req.user.userId]
    );
    if (!own.rows.length) {
      return res.status(403).json({ error: 'You do not own this profile' });
    }

    // Monthly rating trend (last 12 months)
    const trend = await pool.query(
      `SELECT
         date_trunc('month', created_at) AS month,
         ROUND(AVG(rating)::NUMERIC, 2)  AS avg_rating,
         COUNT(*)                         AS review_count
       FROM reviews
       WHERE landlord_id = $1
         AND flagged    = FALSE
         AND created_at >= NOW() - INTERVAL '12 months'
       GROUP BY month
       ORDER BY month`,
      [req.params.id]
    );

    // Category averages
    const cats = await pool.query(
      `SELECT
         ROUND(AVG(communication)::NUMERIC, 2) AS communication,
         ROUND(AVG(maintenance)::NUMERIC,   2) AS maintenance,
         ROUND(AVG(fairness)::NUMERIC,      2) AS fairness
       FROM reviews
       WHERE landlord_id = $1 AND flagged = FALSE`,
      [req.params.id]
    );

    // Response rate
    const responseRate = await pool.query(
      `SELECT
         COUNT(r.id)  AS total_reviews,
         COUNT(rr.id) AS responded
       FROM reviews r
       LEFT JOIN review_responses rr ON r.id = rr.review_id
       WHERE r.landlord_id = $1`,
      [req.params.id]
    );

    res.json({
      trend:         trend.rows,
      categories:    cats.rows[0],
      response_rate: responseRate.rows[0],
    });

  } catch (err) {
    console.error('Analytics error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;

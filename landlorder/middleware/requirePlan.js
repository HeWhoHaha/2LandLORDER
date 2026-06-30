// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// middleware/requirePlan.js — Subscription Plan Gating
//
// Guards routes behind subscription plan requirements.
// Must be used AFTER the auth middleware (needs req.user).
//
// Usage:
//   const { requirePlan, requireReviewQuota } = require('../middleware/requirePlan');
//
//   // Require Landlord Pro to respond to reviews:
//   router.post('/respond', auth, requirePlan('can_respond'), handler);
//
//   // Check review quota before allowing submission:
//   router.post('/reviews', auth, requireReviewQuota, handler);
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const pool = require('../db/pool');

// ── Plan feature matrix ───────────────────────────────────────────
// Maps plan_id to the features it includes.
// Used as fallback if the subscriptions table is missing a row.
const PLAN_DEFAULTS = {
  tenant:     { max_reviews: 3,    max_listings: 1,    can_respond: false, can_claim: false, has_analytics: false, has_api: false },
  verified:   { max_reviews: null, max_listings: null, can_respond: false, can_claim: false, has_analytics: false, has_api: false },
  landlord:   { max_reviews: null, max_listings: 5,    can_respond: true,  can_claim: true,  has_analytics: true,  has_api: false },
  enterprise: { max_reviews: null, max_listings: null, can_respond: true,  can_claim: true,  has_analytics: true,  has_api: true  },
};

// ── getUserPlan: fetch plan + features for a user ─────────────────
// Joins subscriptions → plans to get the full feature set.
// Falls back to free 'tenant' plan if no subscription row exists.
async function getUserPlan(userId) {
  const { rows } = await pool.query(
    `SELECT
       s.plan_id, s.status,
       s.current_period_end,
       s.cancel_at_period_end,
       -- Feature flags (fall back to plan defaults if columns missing)
       COALESCE(p.max_reviews,    $2::int)     AS max_reviews,
       COALESCE(p.max_listings,   $3::int)     AS max_listings,
       COALESCE(p.can_respond,    false)       AS can_respond,
       COALESCE(p.can_claim,      false)       AS can_claim,
       COALESCE(p.has_analytics,  false)       AS has_analytics,
       COALESCE(p.has_api,        false)       AS has_api
     FROM subscriptions s
     LEFT JOIN plans p ON s.plan_id = p.id
     WHERE s.user_id = $1`,
    [userId, null, null]  // $2/$3 = null means unlimited (NULL in DB = no limit)
  );

  if (!rows.length) {
    // No subscription row — return free tier defaults
    return { plan_id: 'tenant', status: 'active', ...PLAN_DEFAULTS.tenant };
  }

  const sub = rows[0];

  // Check if the subscription has expired
  if (sub.current_period_end && new Date(sub.current_period_end) < new Date()) {
    // Grace period over — treat as free tier
    return { plan_id: 'tenant', status: 'expired', ...PLAN_DEFAULTS.tenant };
  }

  return sub;
}

// ── requirePlan: factory that returns a middleware ────────────────
// Pass the feature flag to check. Returns 402 if the user's plan
// doesn't include that feature.
//
// Available feature flags (from the plan feature matrix above):
//   'can_respond'   — can respond to reviews (Landlord Pro)
//   'can_claim'     — can claim a landlord profile (Landlord Pro)
//   'has_analytics' — can see analytics dashboard (Landlord Pro)
//   'has_api'       — can use the API (Enterprise)
const requirePlan = (feature) => async (req, res, next) => {
  try {
    const plan = await getUserPlan(req.user.userId);
    req.plan = plan; // attach to req so handler can access plan details

    // Check subscription status
    if (!['active', 'trialing'].includes(plan.status)) {
      return res.status(402).json({
        error:       'Active subscription required',
        plan_id:     plan.plan_id,
        status:      plan.status,
        upgrade_url: '/pricing',
        // 402 = Payment Required — semantic HTTP code for paywalled content
      });
    }

    // Check if the feature is included in their plan
    if (feature && !plan[feature]) {
      return res.status(402).json({
        error:       `Your ${plan.plan_id} plan does not include this feature`,
        feature,
        plan_id:     plan.plan_id,
        upgrade_url: '/pricing',
      });
    }

    next(); // plan check passed

  } catch (err) {
    console.error('requirePlan error:', err.message);
    res.status(500).json({ error: 'Could not verify subscription' });
  }
};

// ── requireReviewQuota: checks annual review limit ─────────────────
// Free plan: 3 reviews per year.
// Verified/Landlord/Enterprise: unlimited (max_reviews = NULL).
const requireReviewQuota = async (req, res, next) => {
  try {
    const plan = await getUserPlan(req.user.userId);
    req.plan = plan;

    // NULL max_reviews = unlimited — skip the count check
    if (plan.max_reviews === null) return next();

    // Count reviews submitted this calendar year
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count
       FROM usage_events
       WHERE user_id    = $1
         AND event_type = 'review_submitted'
         AND created_at >= date_trunc('year', NOW())`,
      [req.user.userId]
    );

    const count = parseInt(rows[0].count);
    if (count >= plan.max_reviews) {
      return res.status(402).json({
        error:       `You have reached your review limit (${plan.max_reviews}/year)`,
        used:        count,
        limit:       plan.max_reviews,
        plan_id:     plan.plan_id,
        upgrade_url: '/pricing',
      });
    }

    next();
  } catch (err) {
    console.error('requireReviewQuota error:', err.message);
    res.status(500).json({ error: 'Could not verify quota' });
  }
};

// ── requireListingQuota: checks annual listing limit ───────────────
// All plans: 1 landlord listing per year (server-side enforcement).
// This is the authoritative check — client-side localStorage is UI only.
const requireListingQuota = async (req, res, next) => {
  try {
    // Count landlord listings added this calendar year
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS count
       FROM usage_events
       WHERE user_id    = $1
         AND event_type = 'listing_added'
         AND created_at >= date_trunc('year', NOW())`,
      [req.user.userId]
    );

    const count = parseInt(rows[0].count);
    if (count >= 1) {
      const nextYear = new Date(new Date().getFullYear() + 1, 0, 1);
      const daysLeft = Math.ceil((nextYear - new Date()) / 864e5);

      return res.status(402).json({
        error:    `Annual listing limit reached (1 per year)`,
        used:     count,
        limit:    1,
        days_remaining: daysLeft,
        resets_on: nextYear.toISOString().split('T')[0],
      });
    }

    next();
  } catch (err) {
    console.error('requireListingQuota error:', err.message);
    res.status(500).json({ error: 'Could not verify listing quota' });
  }
};

module.exports = { requirePlan, requireReviewQuota, requireListingQuota, getUserPlan };

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// routes/billing.js — Stripe Billing Routes
//
// POST /api/billing/checkout  — start Stripe Checkout (upgrade plan)
// POST /api/billing/portal    — open Stripe Customer Portal
// GET  /api/billing/plan      — current user's plan + permissions
// POST /api/billing/webhook   — Stripe event handler (no JWT auth)
//
// IMPORTANT: The webhook route MUST be mounted before express.json()
// middleware in index.js because it needs the raw request body to
// verify the Stripe signature. This is why index.js mounts it first.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const express = require('express');
const router  = express.Router();
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
const {
  stripe,
  createCheckoutSession,
  createPortalSession,
  getPlanFromPrice,
} = require('../services/stripe');


// ── POST /api/billing/checkout ────────────────────────────────────
// Creates a Stripe Checkout session and returns the URL.
// Frontend redirects: window.location.href = data.url
// Requires auth — must know which user is upgrading.
router.post('/checkout', auth, async (req, res) => {
  const { priceId } = req.body;

  if (!priceId) {
    return res.status(400).json({ error: 'Price ID is required' });
  }

  try {
    const session = await createCheckoutSession(
      req.user.userId,
      req.user.email,
      priceId
    );
    res.json({ url: session.url });
    // Frontend does: window.location.href = data.url

  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── POST /api/billing/portal ──────────────────────────────────────
// Creates a Stripe Customer Portal session and returns the URL.
// Lets users manage their subscription without building a billing UI.
// Requires auth.
router.post('/portal', auth, async (req, res) => {
  try {
    const session = await createPortalSession(req.user.userId);
    res.json({ url: session.url });

  } catch (err) {
    console.error('Portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// ── GET /api/billing/plan ─────────────────────────────────────────
// Returns the current user's plan, status, and feature permissions.
// Called by the frontend on load to gate features in the UI.
// Also used by the pricing page to show current plan.
router.get('/plan', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         s.plan_id,
         s.status,
         s.billing_period,
         s.current_period_end,
         s.cancel_at_period_end,
         -- Feature flags from plans table (or defaults if no plans table)
         COALESCE(p.name,          s.plan_id)   AS plan_name,
         COALESCE(p.price_monthly, 0)            AS price_monthly,
         COALESCE(p.price_annual,  0)            AS price_annual,
         COALESCE(p.max_reviews,   3)            AS max_reviews,
         COALESCE(p.max_listings,  1)            AS max_listings,
         COALESCE(p.can_respond,   false)        AS can_respond,
         COALESCE(p.can_claim,     false)        AS can_claim,
         COALESCE(p.has_analytics, false)        AS has_analytics,
         COALESCE(p.has_api,       false)        AS has_api
       FROM subscriptions s
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE s.user_id = $1`,
      [req.user.userId]
    );

    if (!rows.length) {
      // No subscription row — return free tier defaults
      return res.json({
        plan_id:      'tenant',
        plan_name:    'Tenant',
        status:       'active',
        max_reviews:  3,
        max_listings: 1,
        can_respond:  false,
        can_claim:    false,
        has_analytics:false,
        has_api:      false,
      });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error('Plan fetch error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});


// ── webhookHandler: POST /api/billing/webhook ─────────────────────
// Stripe calls this URL when subscription events happen.
// This is how we know when someone pays, cancels, or fails to renew.
//
// CRITICAL SECURITY: We must verify every request is really from Stripe
// using the webhook signature. Without this, anyone could fake events.
//
// This handler is exported separately and mounted in index.js BEFORE
// express.json() because signature verification requires the raw body.
const webhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    // Verify the event came from Stripe using the webhook secret
    // req.body is the raw Buffer (express.raw middleware applied in index.js)
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Process the event
  try {
    switch (event.type) {

      // ── Payment succeeded → activate subscription ───────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId  = session.metadata.landlorder_user_id;
        const subId   = session.subscription;

        // Fetch full subscription details from Stripe
        const sub     = await stripe.subscriptions.retrieve(subId);
        const priceId = sub.items.data[0].price.id;
        const planId  = getPlanFromPrice(priceId);

        await pool.query(
          `UPDATE subscriptions SET
             plan_id                = $1,
             status                 = 'active',
             stripe_subscription_id = $2,
             stripe_price_id        = $3,
             current_period_start   = $4,
             current_period_end     = $5,
             updated_at             = NOW()
           WHERE user_id = $6`,
          [
            planId, subId, priceId,
            new Date(sub.current_period_start * 1000),
            // Stripe uses Unix timestamps — multiply by 1000 for JS Date
            new Date(sub.current_period_end   * 1000),
            userId,
          ]
        );
        console.log(`Subscription activated: user ${userId} → plan ${planId}`);
        break;
      }

      // ── Renewal succeeded → update period dates ─────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (!invoice.subscription) break; // skip non-subscription invoices

        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        await pool.query(
          `UPDATE subscriptions SET
             status               = 'active',
             current_period_start = $1,
             current_period_end   = $2,
             updated_at           = NOW()
           WHERE stripe_subscription_id = $3`,
          [
            new Date(sub.current_period_start * 1000),
            new Date(sub.current_period_end   * 1000),
            invoice.subscription,
          ]
        );
        break;
      }

      // ── Payment failed → mark as past_due (grace period) ────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await pool.query(
          `UPDATE subscriptions SET
             status     = 'past_due',
             updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [invoice.subscription]
        );
        // User still has access during grace period — Stripe retries payment
        console.log(`Payment failed for subscription: ${invoice.subscription}`);
        break;
      }

      // ── Subscription cancelled → downgrade to free ───────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await pool.query(
          `UPDATE subscriptions SET
             plan_id                = 'tenant',
             status                 = 'cancelled',
             stripe_subscription_id = NULL,
             current_period_end     = NULL,
             updated_at             = NOW()
           WHERE stripe_subscription_id = $1`,
          [sub.id]
        );
        console.log(`Subscription cancelled: ${sub.id}`);
        break;
      }

      // ── Plan changed (upgrade/downgrade) ────────────────────────
      case 'customer.subscription.updated': {
        const sub     = event.data.object;
        const priceId = sub.items.data[0].price.id;
        const planId  = getPlanFromPrice(priceId);

        await pool.query(
          `UPDATE subscriptions SET
             plan_id              = $1,
             status               = $2,
             cancel_at_period_end = $3,
             current_period_end   = $4,
             updated_at           = NOW()
           WHERE stripe_subscription_id = $5`,
          [
            planId,
            sub.status,
            sub.cancel_at_period_end,
            new Date(sub.current_period_end * 1000),
            sub.id,
          ]
        );
        break;
      }

      default:
        // Log unhandled event types but don't error
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    // Always return 200 to Stripe — if we return an error,
    // Stripe will retry the webhook for up to 72 hours
    res.json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err.message);
    // Return 500 so Stripe knows to retry this event
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

module.exports = { router, webhookHandler };

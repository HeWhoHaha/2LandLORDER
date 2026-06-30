// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// middleware/auth.js — Supabase JWT Verification
//
// This middleware is a "gatekeeper" placed in front of protected
// routes. It runs BEFORE the route handler and either:
//   ✓ Verifies the Supabase JWT → attaches req.user → calls next()
//   ✗ Rejects invalid/missing tokens → returns 401
//
// Usage:
//   const auth = require('../middleware/auth');
//   router.post('/landlords', auth, async (req, res) => { ... });
//   // req.user = { userId, email } inside the handler
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { createClient } = require('@supabase/supabase-js');

// Supabase admin client using the SERVICE KEY (not anon key)
// The service key bypasses Row Level Security — safe on the server
// but NEVER expose it to the frontend
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── auth middleware ───────────────────────────────────────────────
// Express middleware signature: (req, res, next)
// req  = incoming HTTP request (we read the Authorization header)
// res  = outgoing HTTP response (we send 401 if auth fails)
// next = function to call when auth passes (proceeds to route handler)
module.exports = async (req, res, next) => {
  try {
    // Extract token from Authorization header
    // Header format: "Bearer eyJhbGci..."
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    // .split(' ') → ['Bearer', 'eyJhbGci...']
    // [1]         → just the token string

    // Verify the token with Supabase
    // This calls Supabase's /auth/v1/user endpoint to validate
    // and decode the JWT, returning the user if valid
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user info to req so route handlers can use it
    // req.user is available in any route that uses this middleware
    req.user = {
      userId: user.id,               // Supabase UUID
      email:  user.email,            // user's email address
      role:   user.user_metadata?.role || 'tenant', // custom role if set
    };

    next(); // token is valid — proceed to the route handler

  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ error: 'Authentication service unavailable' });
  }
};

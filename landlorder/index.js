// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// index.js — LandLORDER! API Server
// Entry point: creates the Express app, attaches all middleware,
// mounts all route files, and starts listening for requests.
//
// Run locally:  npm run dev   (nodemon — auto-restarts on save)
// Run in prod:  npm start     (Railway runs this automatically)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// MUST be the very first line — loads .env into process.env
// so every subsequent require() can access environment variables
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();

// ── CORS ──────────────────────────────────────────────────────────
// Browsers block cross-origin requests by default.
// This tells the browser which frontend domains are allowed to
// call this API. Without CORS the frontend gets a network error.
const allowedOrigins = [
  'http://localhost:5173',                    // Vite local dev
  'http://localhost:4173',                    // Vite preview
  process.env.FRONTEND_URL,                  // Vercel production URL
].filter(Boolean);                            // remove undefined entries

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,                          // allow cookies / auth headers
}));

// ── JSON BODY PARSER ──────────────────────────────────────────────
// Parses incoming request bodies as JSON.
// Without this, req.body is always undefined.
// NOTE: must come AFTER the Stripe webhook route (which needs raw body)
// so we mount the webhook route before this middleware below.
app.use('/api/billing/webhook',
  require('express').raw({ type: 'application/json' }),
  require('./routes/billing').webhookHandler
);

// Now attach JSON parser for all other routes
app.use(express.json());

// ── RATE LIMITER ──────────────────────────────────────────────────
// Prevents spam, brute-force attacks, and review flooding.
// 100 requests per 15 minutes per IP address.
// Returns HTTP 429 Too Many Requests when limit is exceeded.
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,                 // 15 minutes in ms
  max: 100,                                  // max requests per window
  standardHeaders: true,                     // include RateLimit headers
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later' },
}));

// ── HEALTH CHECK ──────────────────────────────────────────────────
// Used by Railway and Docker healthcheck to verify the server is up.
// Returns 200 OK if the server is running.
app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '2.0.0',
  timestamp: new Date().toISOString(),
}));

// ── ROUTE MOUNTING ────────────────────────────────────────────────
// Each route file handles a group of related endpoints.
// The prefix here + the path in the route file = full URL.
//
// /api/auth      → POST /api/auth/register, POST /api/auth/login
// /api/landlords → GET  /api/landlords, GET /api/landlords/:id, POST /api/landlords
// /api           → GET  /api/landlords/:id/reviews, POST /api/reviews/:id/flag
// /api/billing   → POST /api/billing/checkout, POST /api/billing/portal, GET /api/billing/plan
// /api/users     → GET  /api/users/me/quota
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/landlords', require('./routes/landlords'));
app.use('/api',           require('./routes/reviews'));
app.use('/api/billing',   require('./routes/billing').router);
app.use('/api/users',     require('./routes/users'));

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────────
// Catches any unhandled errors thrown by route handlers.
// Express calls this when next(err) is called or a route throws.
// Must have 4 parameters for Express to recognize it as error handler.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  // Don't expose internal error details in production
  const isDev = process.env.NODE_ENV !== 'production';
  res.status(err.status || 500).json({
    error: isDev ? err.message : 'Internal server error',
  });
});

// ── START SERVER ──────────────────────────────────────────────────
// process.env.PORT is set automatically by Railway in production.
// Falls back to 3001 for local development.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LandLORDER! API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

# LandLorder — Publication Gap Analysis

**Audited:** 2026-06-10  
**Repository state:** 2 files, no app code

---

## What currently exists

| File | Content |
|------|---------|
| `README.md` | GitHub Desktop default template, name filled in |
| `LandLorder.api` | 5 lines of mock `gh repo create` CLI output; `yourname` is still a placeholder |

**There is no application.** No source code, no schema, no credentials, no scaffold, no config.

---

## The 3 blocking gaps

Nothing can be deployed until these three are resolved. All other work depends on them.

### 1. No project scaffold

No `package.json`, no Vite config, no React component, no `src/` directory. The app does not exist as code yet.

**Fix:**
```bash
npm create vite@latest landlorder -- --template react
cd landlorder
npm install
```

### 2. No database

No schema file exists. No `CREATE TABLE` statements for `properties`, `reviews`, or `users`. No database has been provisioned.

**Fix:**
- Provision Postgres on Railway or Supabase
- Write and run schema migrations
- Store the connection string as an environment variable — never in source code

### 3. No environment configuration

No `.env`, no `.env.example`, no config layer. Any real credentials (Supabase URL, anon key, database URL) must be wired through environment variables before the app can connect to anything.

**Fix:**
- Create `.env.example` listing all required variable names with no real values
- Add `.env` to `.gitignore` immediately
- Use `import.meta.env.VITE_*` in Vite for frontend variables

---

## Full publication checklist

### Week 1 — Get it running locally

- [ ] `npm create vite@latest` — create the project scaffold
- [ ] Build core components: property search, review form, review list
- [ ] Create `.env.example` with all required variable names (no real values)
- [ ] Write and apply the database schema (properties, reviews, users tables)
- [ ] Wire up Supabase or Postgres client using environment variables
- [ ] Confirm the app runs locally with `npm run dev`

### Week 2 — Make it deployable

- [ ] Add `vercel.json` or connect the repo to Vercel via dashboard
- [ ] Set all environment variables in Vercel project settings (never commit real values)
- [ ] Add server-side validation — frontend-only checks can be bypassed with `curl`
- [ ] Configure Row Level Security (RLS) policies so users can only edit their own reviews
- [ ] Add rate limiting on the review submission endpoint
- [ ] Confirm `npm run build` produces a clean production build with no errors

### Week 3 — Make it launchable

- [ ] Write a real `README.md` describing the app, setup instructions, and environment variables required
- [ ] Add a Terms of Service page
- [ ] Add a Privacy Policy page
- [ ] Set up error monitoring (Sentry free tier)
- [ ] Test the full user flow on the deployed Vercel URL
- [ ] Replace the `yourname` placeholder in `LandLorder.api` or delete the file

---

## Two things most people skip that hurt later

### Server-side validation

Anyone can open DevTools or use `curl` to submit a review with a 10,000-character body, a SQL fragment, or a fake property ID. Your Supabase RLS policies and a server function need to validate length, type, and ownership — not just the React form.

### Terms of Service

A landlord review platform is legally exposed. If a landlord claims a review is defamatory and demands takedown, you need a ToS that establishes your platform's liability limits and your moderation rights. Without it, you have no documented basis for any content decision you make. This is not optional for a review platform.

---

## Realistic estimate

| Phase | Work | Blocker if skipped |
|-------|------|--------------------|
| Week 1 | Scaffold + schema + local run | Nothing else is possible |
| Week 2 | Deployment + security | App is broken or unsafe in production |
| Week 3 | Legal + polish | Liability exposure; unprofessional launch |

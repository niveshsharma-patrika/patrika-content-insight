# Patrika Editorial Insights — Project Memory

> Deep reference for this codebase. Read this before making changes.
> Last mapped: 2026-06-03 (commit `6a8821e`).

## 1. What this is

A **real-time editorial-QA dashboard** for [patrika.com](https://www.patrika.com). Every hour it
discovers freshly published articles from Patrika's news sitemap, scrapes each one (plus its AMP
version), scores it against **77 editorial + SEO compliance rules**, stores the results, and **nudges
authors/editors over Telegram** when an article's score drops below 80. The home page also shows a
**daily-issues trend** and nightly **Core Web Vitals**. Login is **role-based** (admin/editor/viewer).
Editors drill into violations, toggle rules on/off, and manage authors/editors/sections.

- **Stack:** Next.js **16.2.5** (App Router, React 19.2.4), TypeScript, Tailwind CSS v4.
- **Data:** Supabase (Postgres) via service-role key, server-side only.
- **AI:** Google Gemini (`gemini-2.5-flash`) for URL-slug language classification (English vs Hinglish).
- **Perf:** Google PageSpeed Insights API for daily Core Web Vitals on the homepage + latest article.
- **Hosting:** Vercel, region `bom1` (Mumbai). Two crons: hourly scrape + daily-midnight CWV. Project = `rajasthan-patrikas-projects/patrika-content-insight`.
- **Repo:** https://github.com/niveshsharma-patrika/patrika-content-insight

> ⚠️ **Next.js 16 caveat** (see `AGENTS.md`): this is NOT the Next.js in your training data. APIs,
> conventions, and file layout differ. The auth gate lives in `proxy.ts` (Next 16's replacement for
> `middleware.ts`). Consult `node_modules/next/dist/docs/` before writing Next-specific code.

## 2. The pipeline (end to end)

**Discover → Scrape → Analyze → Score → Store → Notify**, all driven by the hourly cron.

1. **Discover** (`lib/sitemap.ts`) — fetch `https://www.patrika.com/google-news-sitemap-v1.xml`,
   parse with `fast-xml-parser`. Each entry: `url, publishedAt, title, language, keywords?, genres?`.
   5-min in-memory cache (cron force-refreshes to bypass it).
2. **Scrape** (`lib/scraper.ts`) — `scrapeArticle(url)`: 25s timeout, hostname allowlist (`*.patrika.com`
   HTTPS only). Cheerio extracts H1, meta/OG/Twitter tags, canonical, author, JSON-LD, paragraphs,
   images, embeds, links, hreflangs. Also captures perf (TTFB, redirects, bytes) and `<head>` SEO
   signals (render-blocking scripts/styles, font-display, third-party scripts, AMP link). Returns a
   `ScrapedArticle` (155+ fields) or an error object.
   Also (when the page advertises `<link rel="amphtml">`) fetches + analyzes the **AMP version** into
   `ScrapedArticle.amp` (`fetchAndAnalyzeAmp`/`analyzeAmp` in `scraper.ts`): validity, body word count,
   schema, embed count. AMP fetch is fail-soft (15s timeout, never sinks the canonical scrape).
3. **Analyze** (`lib/analyze.ts` + `lib/rules.ts`) — `runRules()` evaluates all enabled rules;
   `buildAnalysis()` assembles an `ArticleAnalysis` with separate **editorialScore** and **seoScore**.
4. **Store** (`lib/articleStore.ts`) — `writeArticle()` upserts to `articles` (full payload in JSONB
   `payload` + denormalized hot columns). ⚠️ **`article_scores` and `rule_results` are currently NOT
   written by the cron (both tables are empty); all scoring is computed on the fly from the JSONB
   payload at render time.** The cron's `daily_snapshots` row now also stores per-day `total_errors`,
   `total_warnings`, and avg editorial/SEO scores (`updateDailySnapshotAggregates`) for the trend graph.
5. **Notify** (`lib/telegram.ts`) — two independent tracks (see §6).

### Dashboard data flow (perf)

The home page (`getDayDashboard` in `lib/analyze.ts`) does **ONE whole-day read + analysis pass**, then
ships compact **`ArticleLite`** records (failed rules only, not all 77 results) to the client.
Hour-switching and every filter (author/section/status/scope/rule) resolve **client-side** in
`ComplianceSection` — no per-click server round-trip. The author filter auto-widens to "All hours" so it
spans the whole day (it used to silently match only the current hour's slice). `getHourDashboard` /
`getCachedDashboardStats` are legacy (kept; `getCachedDashboardStats` is still used by the cron for the
daily aggregate).

## 3. The rules engine (77 rules)

- Defined in **`lib/rules.ts`** as objects: `{ id, category, scope, title, severity, description, reference?, check(article, sitemap) → RuleResult }`.
- **scope:** `editorial` | `seo` — drives the two separate scores and the two Telegram tracks.
- **category:** `url, headline, meta, intro, body, image, embed, seo, schema, eeat, discover, amp`.
- **AMP family (4 rules, scope `seo`, category `amp`):** `amp-valid-no-critical` (structural "no critical errors" heuristic — handles Patrika's *transformed/SSR* AMP, where `amp-boilerplate` is replaced by `amp-runtime` and a raw `<img>` lives inside each `<amp-img>`), `amp-canonical-content-match` (AMP body within 70–130% of canonical word count), `amp-schema-match` (AMP vs canonical NewsArticle headline + datePublished), `amp-embed-preserved` (AMP embed count ≥ canonical). All four `ok()`-skip when an article has no AMP version or the AMP page couldn't be fetched. Data comes from `ScrapedArticle.amp` (see §2).
- **severity:** `error` (weight 3), `warning` (2), `info` (1).
- **Score:** `(passed / total) × 100`, computed separately for editorial vs SEO rule subsets.
- **Editor on/off toggles** (`lib/ruleSettings.ts`): `getDisabledRuleIds()` reads the **`rule_overrides`**
  table `(rule_id PK, enabled)`, 5-min cache, invalidated on write. Disabled rules don't count toward
  scores, violations, top-issues, or nudges. Fail-soft: errors → treat all as enabled.
- **Section exemptions:** `astrology-and-spirituality` and `health-news` sections are exempt from
  Hinglish-slug rules (domain terms like mantra/vrat/ayurveda are allowed).
- Notable rule families: URL (devanagari/junk/length/English-slug), headline (present/single-H1/length/
  clickbait), meta description, intro word count (40–200), body (≥350 words w/ 5% leniency, H2s,
  internal links, "यह भी पढ़ें" block; `/videos/` + placeholders exempt), images (feature present,
  ≥1200×670, alt text + keyword, dimensions), embeds (video position), SEO basics (canonical, OG,
  robots indexable, viewport, charset, https, mixed-content), schema (NewsArticle JSON-LD, dates,
  author Person), E-E-A-T (real byline, author link, visible dates), Discover (clickbait, keyword match).

## 4. Gemini AI (slug language check)

- **`lib/gemini.ts`** `checkSlugsWithGemini(urls)`: classifies each URL slug as
  `clear` (proper English, score 80–100), `hinglish` (transliterated Hindi nouns/verbs, 30–69 — a
  Patrika style red line), or `gibberish` (0–29). Also tags language: english/hinglish/mixed/unknown.
- Batches ≤30 uncached slugs/call. Results cached forever in **`slug_verdicts`** (PK `slug`). Feeds the
  `url-slug-english-only` rule. The cron pre-caches everything — the UI panel is display-only.
- Usage/cost tracked in **`gemini_usage`** (per IST date) by `lib/geminiUsage.ts`
  (input $0.075/1M tok, output $0.3/1M tok).
- Model configurable via `GEMINI_MODEL` (default `gemini-2.5-flash`). No key → rule shows "not generated".

## 5. The cron jobs

### 5a. Hourly scrape (`app/api/cron/scrape/route.ts`)

- **Trigger:** Vercel cron, `vercel.json` schedule `30 * * * *` (every hour at :30), region `bom1`.
- **Auth:** `Authorization: Bearer ${CRON_SECRET}` → 401 if missing. **This is the only protected route
  the auth proxy lets through unauthenticated** (it has its own bearer check).
- **Concurrency:** 12 parallel scrape workers. **Cap:** 200 articles/run (Vercel ~5-min timeout).
- **Steps:** acquire lock row in `cron_runs` (unique partial index on `status='running'` → overlapping
  ticks return `skipped`); sweep stale locks >30min → `crashed`; compute cutoff from `max(published_at)`;
  force-refresh sitemap; write `daily_snapshots`; enforce **7-day retention** (purge old articles/
  snapshots/cron_runs, cascades to scores+rule_results); diff sitemap vs cutoff (numeric ms compare for
  UTC/IST safety, drain oldest-first if backlog); scrape; **auto-import sections** (first URL segment) +
  **authors** (new bylines → `app_users`); Gemini slug analysis; score + notify per article; write
  `article_scores`; mark `cron_runs` success with stats.

### 5b. Daily Core Web Vitals (`app/api/cron/cwv/route.ts`)

- **Trigger:** Vercel cron, schedule `30 18 * * *` = **00:00 IST** (Vercel crons run in UTC; 18:30 UTC = midnight Kolkata). Same `Bearer ${CRON_SECRET}` auth, `maxDuration` 300s.
- **What:** measures **2 URLs** — the homepage (`https://www.patrika.com`) and the **latest published article** (newest `articles.published_at` where `ok=true`) — on **both `mobile` and `desktop`** = 4 PSI calls, run concurrently via `Promise.allSettled` (per-call failures tolerated, stored as a row with `error` set).
- **How:** `lib/cwv.ts` `fetchPsi(url, strategy)` calls Google PSI v5 (`/pagespeedonline/v5/runPagespeed`, `category=performance`, optional `PAGESPEED_API_KEY`), normalizing **lab** metrics (perf score, LCP, CLS, FCP, TBT, Speed Index, TTFB) + **CrUX field** p75 (LCP, INP, CLS, overall verdict). CrUX CLS percentile is ÷100.
- **Store:** `writeCwvReport()` upserts to **`cwv_reports`** keyed `(ist_date, page_type, strategy)`. 7-day retention via `purgeCwvReportsOlderThan()`.
- **Display:** home page renders `<CoreWebVitals>` from `readLatestCwvReports()` (newest row per page+strategy). Ratings use Google's good/needs-improvement/poor thresholds (`rate()` in `lib/cwv.ts`).
- ⚠️ **Needs a `PAGESPEED_API_KEY`** in practice — the keyless PSI quota is a shared global pool and returns HTTP 429 `RESOURCE_EXHAUSTED` when exhausted. Get a key from Google Cloud (enable the PageSpeed Insights API) and set it on Vercel.

## 6. Telegram notifications (`lib/telegram.ts`)

Two independent tracks, deduped by chat ID within each track (someone with both roles gets both):

- **Editorial track** (editorialScore < 80): the **author** (if mapped to an `app_users` row with a
  `telegram_chat_id`) + **editors** whose `roles[]` includes `editorial`. Message = `buildAuthorAlert()`.
- **SEO track** (seoScore < 80): **editors** whose `roles[]` includes `seo`. Message = `buildSeoAlert()`.
- Send failures are logged but never fail the cron. Manual trigger: `POST /api/telegram/notify {id}`.
- Test connectivity: `GET /api/telegram/test` (bot info), `POST /api/telegram/test {chatId}`.

## 7. Auth model (role-based)

- **Login users:** the **`dashboard_users`** table (id, username unique, scrypt `password_hash`, `role`,
  active) holds per-user accounts. `lib/dashboardUsers.ts` (Node-only — scrypt via `node:crypto`) does
  hashing + CRUD + `authenticateUser()`. The env **`DASHBOARD_USERNAME`/`PASSWORD` remain a built-in
  super-admin break-glass** login (always resolves to `admin`), so the owner is never locked out.
- **Roles (`Role` in `lib/auth.ts`):** `admin` > `editor` > `viewer` (`roleAtLeast`). **Admin** = full
  access incl. managing login users. **Editor** = manage authors/sections/editors, toggle rules, notify.
  **Viewer** = read-only.
- **Login:** `POST /api/auth/login` → `authenticateUser()` (DB users first, then env break-glass) → sets
  **`pci_session`** cookie. `app/login/LoginForm.tsx` hard-navigates after success.
- **Session cookie `pci_session`:** JWT-style `base64url(payload).base64url(sig)`, payload now
  `{user, role, exp, v}` (v=**2** — old v1 cookies rejected → one-time re-login), sig = HMAC-SHA256 keyed
  off SHA-256 of `DASHBOARD_PASSWORD`. → **rotating the password invalidates all sessions.** 30-day life.
- **Gate (`proxy.ts`, edge):** authenticates the cookie on every request (same public/bypass list:
  `/login`, `/api/cron/*`, `/api/auth/*`, static). **Authorization (role) is enforced per-route**, not in
  the proxy: `requireRole(min)` in **`lib/session.ts`** (uses `getServerSession()`) guards every mutating
  API at `editor`, and the login-user APIs at `admin`. Auth-not-configured → dev passthrough as synthetic
  admin. The Settings "Login users" panel renders only for admins.
- **Logout:** `POST /api/auth/logout` clears the cookie. (`LogoutButton`)

## 8. Pages (`app/`)

- `/` (`page.tsx`) — **dashboard**, force-dynamic. Hourly article grid filtered by `?date=` & `?hour=`;
  top-issues panel; 7-day date window. Core UI in `ComplianceSection`.
- `/articles/[id]` — **article detail**: scores, SEO snapshot, rule violations, images, author, notify
  button. `[id]` is a base64url slug hash from `lib/articleId.ts`. Custom `not-found.tsx`.
- `/rules` — **rule catalog** browser grouped by category with per-rule on/off toggles (`RuleToggle`).
- `/settings` — admin hub: `UserManager`, `EditorManager`, `SectionManager`, `CronHistory`,
  `GeminiUsage`, rule counts (6 parallel Supabase queries).
- `/login` — login form.

## 9. API routes (`app/api/`)

All require the session cookie **except** `/api/auth/*` and `/api/cron/*`. **Mutating endpoints
additionally require `editor`+ via `requireRole`** (GET/list endpoints stay viewer-readable).

| Resource | Routes |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/logout` |
| Login users (admin) | `GET\|POST /auth-users`, `DELETE /auth-users/[id]` — `requireRole("admin")` |
| Cron | `GET\|POST /cron/scrape` (hourly), `GET\|POST /cron/cwv` (daily midnight IST) — both Bearer `CRON_SECRET` |
| Editors | `GET\|POST /editors`, `DELETE /editors/[id]` (validates numeric chat ID; roles default `['editorial']`) |
| Users (authors) | `GET\|POST /users`, `DELETE /users/[id]` (aliases = byline variants for fuzzy match) |
| Sections | `GET /sections`, `PATCH /sections/[id]` (displayName/active) |
| Rules | `PATCH /rules/[id] {enabled}` (rejects unknown rule IDs) |
| Telegram | `POST /telegram/notify {id}`, `GET\|POST /telegram/test` |
| Gemini | `GET\|POST /gemini/slugs` (POST: `{urls?, force?, limit?}`) |
| Settings | `GET /settings` (masked key status; POST → 400, creds are env-only) |

## 10. Database schema (`db/schema.sql`, 13 tables)

`articles` (PK url; `article_id`, hot columns + JSONB `payload`, `is_updated`) ·
`article_scores` (PK url FK; editorial/seo/combined + error/warning counts) ·
`rule_results` (PK url+rule_id; passed/severity/scope/message) ·
`slug_verdicts` (PK slug; Gemini cache) ·
`sections` (PK id=slug; display_name/active/first_seen/last_seen) ·
`editors` (id, telegram_chat_id, `roles[]`, active) ·
`app_users` (authors; aliases, telegram_chat_id) ·
`gemini_usage` (PK date IST; token + cost accounting) ·
`cron_runs` (health log; unique partial index on status='running' for locking) ·
`daily_snapshots` (PK date IST; per-day rollups) ·
`rule_overrides` (PK rule_id; enabled — editor toggles) ·
`cwv_reports` (id; unique `(ist_date, page_type, strategy)`; lab + CrUX-field metrics — daily Core Web Vitals) ·
`dashboard_users` (id; username unique, scrypt `password_hash`, `role`, active — login users).
`daily_snapshots` now also carries `total_errors`/`total_warnings`/`avg_editorial_score`/`avg_seo_score`
(written by the cron via `updateDailySnapshotAggregates`). **Note:** `article_scores` and `rule_results`
exist in the schema but are **never written** (empty) — scoring is on-the-fly from the JSONB payload.
All tables have **RLS enabled with no policies** → only the service-role key (server) can read/write.

## 11. Key library files (`lib/`)

`scraper.ts` scrape · `sitemap.ts` discover · `analyze.ts` build analysis · `rules.ts` 73 rules ·
`ruleSettings.ts` toggles (`rule_overrides`) · `articleStore.ts` read/write articles · `articleId.ts`
slug→id hash · `gemini.ts` slug AI · `geminiUsage.ts` cost tracking · `cwv.ts` PSI Core Web Vitals
(fetch/parse/store/read + `rate()` thresholds) · `telegram.ts` nudges ·
`db.ts` Supabase service client (`getDb()`, null if unconfigured) · `dashboardStats.ts` dashboard
aggregates + snapshots (incl. `readRecentSnapshots`, `updateDailySnapshotAggregates`) + cron-run reads ·
`auth.ts` cookie sign/verify + `Role`/`roleAtLeast` (Edge-safe) · `session.ts` `getServerSession`/
`requireRole` · `dashboardUsers.ts` login-user store (scrypt, Node-only) ·
`editors.ts` / `users.ts` (`findUserForByline`, alias matching) /
`sections.ts` admin + auto-import · `dates.ts` IST helpers (`todayInIST`, retention window) ·
`utils.ts` (`categoryFromUrl`, `cn`, relative time) · `config.ts` env config · `types.ts` all types.

## 12. UI components (`components/`)

- **Dashboard:** `ComplianceSection` (client, core container: filters + hour nav + grid), `ArticleCard`
  (server), `TopIssueCard` (client, click→filter by rule), `CronHistory` (server), `GeminiUsage` (server).
- **Filter/nav:** `FilterBar` (client: status/scope/sections/authors/sort), `DatePicker` (server, link-
  based 7-day), `HeaderNav` (client, logo + settings gear; hidden on /login), `Paginator` (client).
- **Admin CRUD (all client):** `EditorManager`, `UserManager`, `SectionManager` — forms calling the APIs
  above with a Test-Telegram button; `LogoutButton`.
- **Rules:** `RuleTabs` (client, editorial/SEO tabs by category), `RuleToggle` (client, optimistic PATCH).
- **AI / notify:** `SlugAIPanel` (server, display-only verdict), `NotifyAuthorButton` (client).
- **Perf / trends:** `CoreWebVitals` (server; homepage + latest article, mobile/desktop, lab + field
  metrics, color-rated), `DailyIssuesChart` (server; stacked errors/warnings per day + avg editorial score).
- **Login users:** `LoginUserManager` (client; admin-only Settings panel — create/edit/deactivate login
  users + set tier). `ComplianceSection`/`ArticleCard` now consume the compact `ArticleLite` (whole-day,
  client-side hour switching + filters).
- **Primitive:** `Badge` (server; error/warning/info/pass/neutral). Styling: Tailwind v4 + `cn()`/
  `tailwind-merge`, lucide-react.

## 13. Environment variables (`.env.local`, all server-side)

| Var | Required | Use |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | full DB access (server only) |
| `CRON_SECRET` | yes | Bearer auth for `/api/cron/scrape` |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | yes | dashboard login + session-signing key |
| `GEMINI_API_KEY` | optional | slug analysis (absent → rule "not generated") |
| `GEMINI_MODEL` | optional | default `gemini-2.5-flash` |
| `TELEGRAM_BOT_TOKEN` | optional | nudges (absent → no messages) |
| `PAGESPEED_API_KEY` | recommended | Core Web Vitals PSI quota (absent → shared keyless quota, often 429s) |

The first 7 are already set on Vercel (Production + Preview). **`PAGESPEED_API_KEY` is new and not yet set** —
add it on Vercel (and `.env.local`) for the CWV cron to work reliably. `.env.local` and `.vercel/` are gitignored.

> **Schema migration pending:** the `cwv_reports` table must be created in Supabase (run `db/schema.sql`,
> which is idempotent, or just the `cwv_reports` block + its RLS line) before the CWV cron can store rows.

## 14. Dev / deploy

- `npm run dev` (local), `npm run build`, `npm start`, `npm run lint`.
- Deploy: linked via Vercel CLI to `patrika-content-insight`. Git `main` auto-deploys (project has the
  `git-main` alias); manual deploy = `vercel --prod`. Live: https://patrika-content-insight.vercel.app
- `package.json` name is `dashboard`. Known: 13 npm-audit advisories (12 moderate, 1 high) in deps.

## 15. Gotchas

- **IST everywhere.** Dates/retention/snapshots use Asia/Kolkata. Sitemap diff compares numeric ms, not
  strings, to avoid UTC↔IST off-by-one. Don't introduce naive string date compares.
- **Two scores, two tracks.** editorial vs seo are independent (score and notification). Keep them separate.
- **Disabled rules must vanish everywhere** — scores, counts, top issues, nudges. Route any new rule-
  consuming code through `getDisabledRuleIds()`.
- **7-day retention** — articles older than 7 days are purged each cron; a missing `/articles/[id]` is
  usually expired data, not a bug (see `not-found.tsx`).
- **Cron self-locks** via the `cron_runs` unique partial index; never bypass it or you risk double runs.
- **Service-role key is god-mode** and bypasses RLS — never expose `getDb()` output or that key to client code.

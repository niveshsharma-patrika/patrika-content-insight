-- Patrika Content Insight — Supabase schema.
-- Idempotent: safe to run repeatedly.
-- Open Supabase → SQL Editor → paste this file → Run.

-- =========================================================================
-- 1. Articles + their full payloads
-- =========================================================================
CREATE TABLE IF NOT EXISTS articles (
  url                   TEXT PRIMARY KEY,
  -- Stable id derived from URL slug; used for /articles/[id] routing.
  article_id            TEXT,
  category              TEXT,
  sitemap_title         TEXT,
  sitemap_published_at  TIMESTAMPTZ,
  scraped_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok                    BOOLEAN NOT NULL,
  scrape_error          TEXT,
  -- Hot-path columns for fast filters/sorts
  h1_title              TEXT,
  meta_description      TEXT,
  word_count            INTEGER,
  internal_link_count   INTEGER,
  has_read_also         BOOLEAN,
  author                TEXT,
  author_link           TEXT,
  published_at          TIMESTAMPTZ,
  modified_at           TIMESTAMPTZ,
  og_image              TEXT,
  -- Full ScrapedArticle for the rule engine
  payload               JSONB NOT NULL
);

-- Migration safety: add article_id column on databases created from an
-- earlier version of this schema.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS article_id TEXT;

-- True the second (or later) time we scrape the same URL — i.e. the
-- cron's diff picked it up because Patrika bumped its publication
-- timestamp. Surfaces in the dashboard as an "Updated" tag so editors
-- can spot articles that were re-published / re-edited.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS is_updated BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_articles_published      ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_category       ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_author         ON articles(author);
CREATE INDEX IF NOT EXISTS idx_articles_scraped_recent ON articles(scraped_at DESC) WHERE ok = true;
CREATE INDEX IF NOT EXISTS idx_articles_article_id     ON articles(article_id);

-- =========================================================================
-- 2. Pre-computed per-article scores (fast leaderboards & filters)
-- =========================================================================
CREATE TABLE IF NOT EXISTS article_scores (
  url              TEXT PRIMARY KEY REFERENCES articles(url) ON DELETE CASCADE,
  editorial_score  INTEGER,
  seo_score        INTEGER,
  combined_score   INTEGER,
  error_count      INTEGER,
  warning_count    INTEGER,
  computed_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_editorial ON article_scores(editorial_score);
CREATE INDEX IF NOT EXISTS idx_scores_seo       ON article_scores(seo_score);
CREATE INDEX IF NOT EXISTS idx_scores_combined  ON article_scores(combined_score);

-- =========================================================================
-- 3. Per-rule outcomes (one row per article × rule)
--    Top-violations panel becomes a one-line indexed SQL.
-- =========================================================================
CREATE TABLE IF NOT EXISTS rule_results (
  url       TEXT NOT NULL REFERENCES articles(url) ON DELETE CASCADE,
  rule_id   TEXT NOT NULL,
  passed    BOOLEAN NOT NULL,
  severity  TEXT,
  scope     TEXT,
  message   TEXT,
  detail    TEXT,
  PRIMARY KEY (url, rule_id)
);

CREATE INDEX IF NOT EXISTS idx_rule_failed ON rule_results(rule_id) WHERE passed = false;
CREATE INDEX IF NOT EXISTS idx_rule_url    ON rule_results(url);

-- =========================================================================
-- 4. Gemini slug verdicts (replaces .data/gemini/slugs.json)
-- =========================================================================
CREATE TABLE IF NOT EXISTS slug_verdicts (
  slug      TEXT PRIMARY KEY,
  verdict   TEXT,
  score     INTEGER,
  language  TEXT,
  notes     TEXT,
  cached_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 4b. Sections / categories
--     Auto-imported from each article's URL slug (the leading path
--     segment, e.g. `jaipur-news`). The cron upserts every section it
--     encounters; the editor renames or deactivates them in Settings.
-- =========================================================================
CREATE TABLE IF NOT EXISTS sections (
  id              TEXT PRIMARY KEY,        -- url slug, e.g. "jaipur-news"
  display_name    TEXT NOT NULL,           -- human label, e.g. "Jaipur"
  active          BOOLEAN DEFAULT TRUE,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sections_active ON sections(active);

-- Bootstrap: seed sections from any articles already in the table on
-- first run of this migration. Idempotent: ON CONFLICT skips dupes.
INSERT INTO sections (id, display_name)
SELECT DISTINCT category, INITCAP(REPLACE(category, '-', ' '))
FROM articles
WHERE category IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- =========================================================================
-- 4c. Editors (recipients of every low-score nudge)
--     Separate from authors: editors don't have bylines and aren't
--     auto-imported. They're manually added in Settings and receive a
--     Telegram message for every article scoring < 80, regardless of
--     who wrote it. Authors only get nudges for their own articles.
-- =========================================================================
CREATE TABLE IF NOT EXISTS editors (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  telegram_chat_id  TEXT NOT NULL,
  active            BOOLEAN DEFAULT TRUE,
  -- Which kinds of nudges this editor wants:
  --   'editorial' → editorialScore < 80
  --   'seo'       → seoScore < 80
  -- Default is editorial-only so existing rows keep their current
  -- behavior when the column is added.
  roles             TEXT[] NOT NULL DEFAULT ARRAY['editorial']::TEXT[],
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- One-shot migration for installs that pre-date the roles column.
-- IF NOT EXISTS makes this idempotent on fresh databases too.
ALTER TABLE editors
  ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT ARRAY['editorial']::TEXT[];

-- =========================================================================
-- 5. Authors (replaces .data/users.json)
--    Named app_users to avoid colliding with Supabase's `users` if used.
-- =========================================================================
CREATE TABLE IF NOT EXISTS app_users (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  aliases           JSONB,
  telegram_chat_id  TEXT,
  active            BOOLEAN DEFAULT TRUE,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 5b. Gemini token usage (per IST day)
--     The cron records cumulative input/output tokens for every batch
--     of slugs we send. Settings → Gemini usage reads this to show
--     today / 7d / lifetime token totals + an estimated USD cost.
-- =========================================================================
CREATE TABLE IF NOT EXISTS gemini_usage (
  date            DATE PRIMARY KEY,
  prompt_tokens   BIGINT NOT NULL DEFAULT 0,
  output_tokens   BIGINT NOT NULL DEFAULT 0,
  request_count   INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 6. Cron health monitoring
-- =========================================================================
CREATE TABLE IF NOT EXISTS cron_runs (
  id           BIGSERIAL PRIMARY KEY,
  started_at   TIMESTAMPTZ DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  scraped      INTEGER DEFAULT 0,
  re_scraped   INTEGER DEFAULT 0,
  errors       INTEGER DEFAULT 0,
  status       TEXT,         -- running / success / failed / skipped / overlap
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_started ON cron_runs(started_at DESC);

-- Unique partial index — at most one cron tick can be in 'running'
-- state at any time. Stops the TOCTOU race where two near-simultaneous
-- cron triggers both observe an empty lock check and both insert a
-- 'running' row, leading to duplicate scrapes and duplicate Telegram
-- nudges. The cron route catches the resulting duplicate-key error
-- and returns status='skipped'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cron_runs_only_one_running
  ON cron_runs(status) WHERE status = 'running';

-- =========================================================================
-- (Optional, future) Daily aggregates for trend lines.
-- =========================================================================
CREATE TABLE IF NOT EXISTS daily_snapshots (
  date                  DATE PRIMARY KEY,
  total_articles        INTEGER,
  avg_editorial_score   INTEGER,
  avg_seo_score         INTEGER,
  total_errors          INTEGER,
  total_warnings        INTEGER
);

-- =========================================================================
-- Rule overrides — editor-controlled on/off switches for the rule catalog.
--
-- A rule with no row here (or `enabled = true`) participates in scoring.
-- `enabled = false` means: skip the rule entirely — no score weight, no
-- violation count, no Telegram nudge trigger. The set is read at every
-- dashboard render and cron tick (cached 5 min in-memory) so a toggle
-- takes effect on the next page load without rescraping articles.
-- =========================================================================
CREATE TABLE IF NOT EXISTS rule_overrides (
  rule_id     TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- Core Web Vitals — daily PageSpeed Insights reports.
--
-- The midnight-IST cron (/api/cron/cwv) measures two URLs (the Patrika
-- homepage and the latest published article) on both mobile and desktop
-- via Google's PSI API, storing one row per (date, page, strategy).
-- The dashboard home page renders the newest row per (page, strategy).
-- 7-day retention, same as articles.
--
--   page_type : 'home' | 'article'
--   strategy  : 'mobile' | 'desktop'
--   *_ms      : Lighthouse LAB metrics (synthetic), milliseconds
--   cls       : Lighthouse LAB Cumulative Layout Shift (unitless)
--   field_*   : CrUX real-user p75 FIELD metrics; NULL when Patrika has
--               no field data for that URL/strategy
-- =========================================================================
CREATE TABLE IF NOT EXISTS cwv_reports (
  id                BIGSERIAL PRIMARY KEY,
  ist_date          TEXT NOT NULL,        -- YYYY-MM-DD (Asia/Kolkata) of the run
  page_type         TEXT NOT NULL,        -- 'home' | 'article'
  strategy          TEXT NOT NULL,        -- 'mobile' | 'desktop'
  url               TEXT NOT NULL,
  -- Lighthouse lab
  performance_score INTEGER,              -- 0–100
  lcp_ms            INTEGER,
  cls               NUMERIC,
  fcp_ms            INTEGER,
  tbt_ms            INTEGER,
  speed_index_ms    INTEGER,
  ttfb_ms           INTEGER,
  -- CrUX field (real-user p75)
  field_lcp_ms      INTEGER,
  field_inp_ms      INTEGER,
  field_cls         NUMERIC,
  field_overall     TEXT,                 -- 'FAST' | 'AVERAGE' | 'SLOW'
  error             TEXT,                 -- set when the PSI call failed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One report per page+strategy per IST day; re-runs upsert.
  UNIQUE (ist_date, page_type, strategy)
);

CREATE INDEX IF NOT EXISTS idx_cwv_reports_date ON cwv_reports(ist_date DESC);

-- =========================================================================
-- Dashboard login users — per-user accounts with permission tiers.
--
-- Separate from app_users (article authors) and editors (Telegram
-- recipients): these are people who can LOG IN. Passwords are scrypt-
-- hashed by lib/dashboardUsers.ts (never stored plaintext). The env
-- DASHBOARD_USERNAME/PASSWORD remains a built-in super-admin break-glass
-- login, so this table can be empty and the owner still gets in.
--
--   role: 'admin'  → full access incl. managing these login users
--         'editor' → manage authors/sections/editors, toggle rules, notify
--         'viewer' → read-only
-- =========================================================================
CREATE TABLE IF NOT EXISTS dashboard_users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'viewer',
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_username ON dashboard_users(username);

-- =========================================================================
-- Row Level Security
--
-- Every read and write in this app goes through the SERVICE_ROLE key,
-- which bypasses RLS by default. Enabling RLS with NO policies means:
--   * The Supabase anon key (public) can do nothing — locked down.
--   * Our server keeps working normally via service_role.
--
-- Net effect: no behavior change for the app, full protection on the
-- public REST API.
-- =========================================================================

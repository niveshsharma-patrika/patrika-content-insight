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
ALTER TABLE articles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE article_scores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_results     ENABLE ROW LEVEL SECURITY;
ALTER TABLE slug_verdicts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cron_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_snapshots  ENABLE ROW LEVEL SECURITY;

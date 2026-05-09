import { SITEMAP_URL } from "./sitemap";
import { todayInIST } from "./dates";
import { rules, runRules } from "./rules";
import { articleId } from "./articleId";
import { readCachedSlugVerdicts } from "./gemini";
import {
  readArticleById,
  readArticlesForIstDate,
  readArticlesForIstHour,
  readPublishedAtsForIstDate,
} from "./articleStore";
import { readDailySnapshot, readLastCronRun } from "./dashboardStats";
import type {
  ArticleAnalysis,
  DashboardSummary,
  RuleCategory,
  RuleScope,
  ScrapedArticle,
  SitemapEntry,
  SlugVerdict,
} from "./types";

export { articleId, SITEMAP_URL };

function severityWeight(sev: "error" | "warning" | "info"): number {
  if (sev === "error") return 3;
  if (sev === "warning") return 2;
  return 1;
}

/**
 * Build an ArticleAnalysis from a sitemap entry + an already-scraped article
 * + the cached Gemini slug verdict (if any). Pure — does no I/O.
 */
function buildAnalysis(
  entry: SitemapEntry,
  article: ScrapedArticle,
  slugVerdict?: SlugVerdict,
  isUpdated: boolean = false,
): ArticleAnalysis {
  if (article.ok && slugVerdict) {
    article.slugVerdict = slugVerdict;
  }
  const results = article.ok ? runRules(article, entry) : [];
  let errorCount = 0;
  let warningCount = 0;
  let passCount = 0;
  let editorialEarned = 0;
  let editorialTotal = 0;
  let seoEarned = 0;
  let seoTotal = 0;
  let topIssue: ArticleAnalysis["topIssue"] | undefined;

  for (const r of results) {
    const w = severityWeight(r.rule.severity);
    if (r.rule.scope === "seo") seoTotal += w;
    else editorialTotal += w;

    if (r.result.passed) {
      passCount += 1;
      if (r.rule.scope === "seo") seoEarned += w;
      else editorialEarned += w;
      continue;
    }

    if (r.rule.severity === "error") errorCount += 1;
    else if (r.rule.severity === "warning") warningCount += 1;

    if (
      !topIssue ||
      severityWeight(r.rule.severity) > severityWeight(topIssue.severity)
    ) {
      topIssue = {
        ruleId: r.rule.id,
        title: r.rule.title,
        severity: r.rule.severity,
        message: r.result.message,
      };
    }
  }

  const totalRules = results.length;
  const score =
    totalRules > 0 ? Math.round((passCount / totalRules) * 100) : 0;
  const editorialScore =
    editorialTotal > 0 ? Math.round((editorialEarned / editorialTotal) * 100) : 0;
  const seoScore =
    seoTotal > 0 ? Math.round((seoEarned / seoTotal) * 100) : 0;

  return {
    sitemap: entry,
    article,
    results,
    errorCount,
    warningCount,
    passCount,
    totalRules,
    score,
    editorialScore,
    seoScore,
    topIssue,
    isUpdated,
  };
}

/**
 * DB-only single-article analysis. Used by the article detail page.
 * Looks the article up by its routing id (computed at scrape time and
 * stored in the `article_id` column). Returns null if nothing matches.
 */
export async function getArticleAnalysisById(
  id: string,
): Promise<ArticleAnalysis | null> {
  const stored = await readArticleById(id);
  if (!stored) return null;
  const verdicts = await readCachedSlugVerdicts([stored.entry.url]);
  return buildAnalysis(
    stored.entry,
    stored.article,
    verdicts[stored.entry.url],
    stored.isUpdated,
  );
}

/**
 * Bucket today's published_at timestamps into 24 IST hour bins. Used
 * to populate the dashboard's hour-pagination strip — each bucket
 * shows its article count and is clickable to jump to that hour.
 */
function bucketIntoIstHours(timestamps: string[]): number[] {
  const counts = new Array<number>(24).fill(0);
  for (const ts of timestamps) {
    const ms = new Date(ts).getTime();
    if (!Number.isFinite(ms)) continue;
    // Convert to IST by adding 5h30m, then read UTC hours of the
    // shifted instant — that's the IST clock-hour.
    const istHour = new Date(ms + 5.5 * 60 * 60 * 1000).getUTCHours();
    if (istHour >= 0 && istHour < 24) counts[istHour] += 1;
  }
  return counts;
}

/**
 * Get a single IST-hour's slice of articles for the dashboard, plus
 * the per-hour counts for all 24 hours of the chosen IST date.
 *
 * Used by the home page. Replaces the old page-based pagination — the
 * editor's mental model is "show me what was published 4-5 PM" rather
 * than "show me page 2 of 11".
 *
 * `requestedHour` is an explicit user choice (from `?hour=N`). When
 * null, we auto-pick the most recent hour with articles, falling
 * back to hour 0 if the day is empty.
 */
export async function getHourDashboard(opts: {
  /** YYYY-MM-DD IST. */
  date: string;
  /** 0-23 IST hour, or null to auto-pick. */
  requestedHour: number | null;
}): Promise<{
  summary: DashboardSummary;
  istDate: string;
  hour: number;
  totalForDate: number;
  totalForHour: number;
  countsPerHour: number[];
  sitemapTotalForDate: number;
  sitemapUrl: string;
  generatedAt: string;
  failedToFetch: number;
  lastCronTickAt: string | null;
  lastCronStatus: string | null;
}> {
  const istDate = opts.date;

  // Phase 1 — pull just the timestamps to compute counts and decide
  // which hour we'll actually render. One small query, cheap.
  const todayPubAts = await readPublishedAtsForIstDate(istDate);
  const countsPerHour = bucketIntoIstHours(todayPubAts);
  const totalForDate = todayPubAts.length;

  // Decide which hour to render.
  let hour: number;
  if (
    opts.requestedHour !== null &&
    Number.isFinite(opts.requestedHour) &&
    opts.requestedHour >= 0 &&
    opts.requestedHour < 24
  ) {
    hour = Math.floor(opts.requestedHour);
  } else {
    // Auto-pick: latest hour that has at least one article.
    let pick = -1;
    for (let h = 23; h >= 0; h--) {
      if (countsPerHour[h] > 0) {
        pick = h;
        break;
      }
    }
    hour = pick >= 0 ? pick : 0;
  }

  // Phase 2 — parallel: hour articles + snapshot + last cron tick.
  const [hourArticles, snapshot, lastTick] = await Promise.all([
    readArticlesForIstHour(istDate, hour),
    readDailySnapshot(istDate),
    readLastCronRun(),
  ]);

  const slugVerdicts = await readCachedSlugVerdicts(
    hourArticles.map((s) => s.entry.url),
  );
  const analyses = hourArticles.map((s) =>
    buildAnalysis(s.entry, s.article, slugVerdicts[s.entry.url], s.isUpdated),
  );
  const summary = buildSummary(analyses);

  return {
    summary,
    istDate,
    hour,
    totalForDate,
    totalForHour: hourArticles.length,
    countsPerHour,
    sitemapTotalForDate: snapshot?.totalArticles ?? totalForDate,
    sitemapUrl: SITEMAP_URL,
    generatedAt: summary.generatedAt,
    failedToFetch: summary.failedToFetch,
    lastCronTickAt: lastTick?.finishedAt ?? lastTick?.startedAt ?? null,
    lastCronStatus: lastTick?.status ?? null,
  };
}

/**
 * Aggregate stats across all of the chosen IST date's stored articles.
 * Used by the Top Issues panel so it reflects the whole day, not just
 * the visible page slice.
 *
 * The returned summary's `articles` field is intentionally an empty
 * array — the home page only consumes the AGGREGATE counts here
 * (topViolations, byCategory, averages). Including the full per-
 * article analyses would push 5–10 MB of redundant JSON to the
 * client (the visible page's analyses already arrive separately as
 * `pageArticles`). Stripping it keeps the payload to a few KB.
 */
export async function getCachedDashboardStats(opts?: {
  date?: string;
}): Promise<DashboardSummary | null> {
  const istDate = opts?.date ?? todayInIST();
  const stored = await readArticlesForIstDate(istDate);
  if (stored.length === 0) return null;
  const slugVerdicts = await readCachedSlugVerdicts(
    stored.map((s) => s.entry.url),
  );
  const analyses = stored
    .filter((s) => s.article.ok)
    .map((s) =>
      buildAnalysis(s.entry, s.article, slugVerdicts[s.entry.url], s.isUpdated),
    );
  const summary = buildSummary(analyses);
  // Drop the heavy per-article payloads from what we hand back —
  // see jsdoc above. Keeps server→client RSC payload tiny.
  return { ...summary, articles: [] };
}

function buildSummary(articles: ArticleAnalysis[]): DashboardSummary {
  const violationMap = new Map<
    string,
    {
      ruleId: string;
      title: string;
      category: RuleCategory;
      scope: RuleScope;
      severity: "error" | "warning" | "info";
      count: number;
    }
  >();
  for (const r of rules) {
    violationMap.set(r.id, {
      ruleId: r.id,
      title: r.title,
      category: r.category,
      scope: r.scope,
      severity: r.severity,
      count: 0,
    });
  }

  const byCategory: DashboardSummary["byCategory"] = {
    url: { errors: 0, warnings: 0 },
    headline: { errors: 0, warnings: 0 },
    meta: { errors: 0, warnings: 0 },
    intro: { errors: 0, warnings: 0 },
    body: { errors: 0, warnings: 0 },
    image: { errors: 0, warnings: 0 },
    embed: { errors: 0, warnings: 0 },
    seo: { errors: 0, warnings: 0 },
    schema: { errors: 0, warnings: 0 },
    eeat: { errors: 0, warnings: 0 },
    discover: { errors: 0, warnings: 0 },
  };

  let errors = 0;
  let warnings = 0;
  let passes = 0;
  let scoreSum = 0;
  let editorialSum = 0;
  let seoSum = 0;
  let analyzed = 0;
  let failedToFetch = 0;

  for (const a of articles) {
    if (!a.article.ok) {
      failedToFetch += 1;
      continue;
    }
    analyzed += 1;
    scoreSum += a.score;
    editorialSum += a.editorialScore;
    seoSum += a.seoScore;
    for (const r of a.results) {
      if (r.result.passed) {
        passes += 1;
        continue;
      }
      const m = violationMap.get(r.rule.id);
      if (m) m.count += 1;
      if (r.rule.severity === "error") {
        errors += 1;
        byCategory[r.rule.category].errors += 1;
      } else if (r.rule.severity === "warning") {
        warnings += 1;
        byCategory[r.rule.category].warnings += 1;
      }
    }
  }

  const topViolations = [...violationMap.values()]
    .filter((v) => v.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    totalArticles: articles.length,
    analyzed,
    failedToFetch,
    errors,
    warnings,
    passes,
    averageScore: analyzed > 0 ? Math.round(scoreSum / analyzed) : 0,
    averageEditorialScore: analyzed > 0 ? Math.round(editorialSum / analyzed) : 0,
    averageSeoScore: analyzed > 0 ? Math.round(seoSum / analyzed) : 0,
    topViolations,
    byCategory,
    articles,
  };
}

// Re-export so other modules don't need to import from sitemap directly
export { todayInIST };

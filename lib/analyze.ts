import { SITEMAP_URL } from "./sitemap";
import { todayInIST } from "./dates";
import { rules, runRules } from "./rules";
import { articleId } from "./articleId";
import { readCachedSlugVerdicts } from "./gemini";
import { readArticleById, readArticlesForIstDate } from "./articleStore";
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
  return buildAnalysis(stored.entry, stored.article, verdicts[stored.entry.url]);
}

/**
 * Get a paginated view of today's articles for the dashboard.
 *
 * DB-only. The cron is the only thing that touches the sitemap; the
 * dashboard reads the rolled-up `daily_snapshots` row for the
 * Patrika-side published-today count, and the `articles` table itself
 * for the actual list.
 *
 * `totalEntries` reports Patrika's published-today count (from the
 * snapshot, may be null on a fresh install before the first cron tick).
 * `cachedCount` reports how many of those are scraped & in our DB.
 */
export async function getPaginatedDashboard(opts?: {
  page?: number;
  perPage?: number;
  /** YYYY-MM-DD (IST). Defaults to today. */
  date?: string;
}): Promise<{
  summary: DashboardSummary;
  totalEntries: number;
  page: number;
  perPage: number;
  pageCount: number;
  cachedCount: number;
  sitemapUrl: string;
  generatedAt: string;
  failedToFetch: number;
  lastCronTickAt: string | null;
  lastCronStatus: string | null;
  istDate: string;
}> {
  const istDate = opts?.date ?? todayInIST();

  const [stored, snapshot, lastTick] = await Promise.all([
    readArticlesForIstDate(istDate),
    readDailySnapshot(istDate),
    readLastCronRun(),
  ]);

  const perPage = opts?.perPage ?? 24;
  const page = Math.max(1, opts?.page ?? 1);
  const pageCount = Math.max(1, Math.ceil(stored.length / perPage));
  const start = (page - 1) * perPage;
  const visible = stored.slice(start, start + perPage);

  const slugVerdicts = await readCachedSlugVerdicts(
    visible.map((s) => s.entry.url),
  );
  const analyses = visible.map((s) =>
    buildAnalysis(s.entry, s.article, slugVerdicts[s.entry.url]),
  );
  const summary = buildSummary(analyses);

  return {
    summary,
    totalEntries: snapshot?.totalArticles ?? stored.length,
    page,
    perPage,
    pageCount,
    cachedCount: stored.length,
    sitemapUrl: SITEMAP_URL,
    generatedAt: summary.generatedAt,
    failedToFetch: summary.failedToFetch,
    lastCronTickAt: lastTick?.finishedAt ?? lastTick?.startedAt ?? null,
    lastCronStatus: lastTick?.status ?? null,
    istDate,
  };
}

/**
 * Aggregate stats across all of the chosen IST date's stored articles.
 * Used by the Top Issues panel so it reflects the whole day, not just
 * the visible page slice.
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
      buildAnalysis(s.entry, s.article, slugVerdicts[s.entry.url]),
    );
  return buildSummary(analyses);
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

/**
 * Core Web Vitals via Google PageSpeed Insights (PSI) API.
 *
 * Once a day (midnight IST) the cron measures two URLs — the Patrika
 * homepage and the latest published article — on both mobile and
 * desktop, then stores the results in `cwv_reports`. The dashboard home
 * page renders the newest report per (page, strategy).
 *
 * Why PSI and not self-hosted Lighthouse: PSI runs Lighthouse on
 * Google's infra and also folds in CrUX real-user (field) data, so we
 * get both lab and field metrics from one HTTPS call — no headless
 * Chrome in the Vercel serverless runtime.
 *
 *   PAGESPEED_API_KEY — optional. Raises the PSI quota. Without it the
 *   keyless quota is ample for 4 calls/night, but a key is recommended
 *   for production.
 */

import { sql, exec, getPool } from "./db";

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export type CwvStrategy = "mobile" | "desktop";
export type CwvPageType = "home" | "article";

/** A single PSI measurement: one URL, one strategy. */
export type CwvMetrics = {
  /** Lighthouse performance category, 0–100. */
  performanceScore: number | null;
  // ---- Lab (synthetic) metrics ----
  lcpMs: number | null; // Largest Contentful Paint
  cls: number | null; // Cumulative Layout Shift (unitless)
  fcpMs: number | null; // First Contentful Paint
  tbtMs: number | null; // Total Blocking Time
  speedIndexMs: number | null;
  ttfbMs: number | null; // Server response time
  // ---- Field (CrUX real-user p75) metrics; null when no field data ----
  fieldLcpMs: number | null;
  fieldInpMs: number | null; // Interaction to Next Paint
  fieldCls: number | null;
  /** CrUX overall verdict: FAST | AVERAGE | SLOW, or null. */
  fieldOverall: string | null;
};

export type CwvReport = CwvMetrics & {
  istDate: string;
  pageType: CwvPageType;
  strategy: CwvStrategy;
  url: string;
  error: string | null;
  createdAt?: string;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Run PSI for one URL + strategy and normalize the (large, deeply
 * nested) response into a flat CwvMetrics. Throws on transport / API
 * error so the caller can record it per-URL without aborting the batch.
 */
export async function fetchPsi(
  url: string,
  strategy: CwvStrategy,
): Promise<CwvMetrics> {
  const key = process.env.PAGESPEED_API_KEY?.trim();
  const params = new URLSearchParams({
    url,
    strategy,
    category: "performance",
  });
  if (key) params.set("key", key);

  // PSI can take 10–30s. Give it a generous timeout but still bound it
  // so a hung request can't eat the whole 5-min cron budget.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`, {
      signal: controller.signal,
      // PSI is a fresh measurement each call; never let any layer cache.
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as {
        error?: { message?: string };
      };
      if (body?.error?.message) detail = body.error.message;
    } catch {
      /* non-JSON error body — keep the HTTP status */
    }
    throw new Error(`PSI ${strategy} failed: ${detail}`);
  }

  const data = (await res.json()) as PsiResponse;
  const audits = data.lighthouseResult?.audits ?? {};
  const score = data.lighthouseResult?.categories?.performance?.score;
  const field = data.loadingExperience?.metrics ?? {};

  // CrUX reports CLS as an integer percentile that is 100× the real
  // value (e.g. 10 → 0.10). LCP/INP are already in ms.
  const fieldClsRaw = num(field.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);

  return {
    performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
    lcpMs: round(audits["largest-contentful-paint"]?.numericValue),
    cls: round2(audits["cumulative-layout-shift"]?.numericValue),
    fcpMs: round(audits["first-contentful-paint"]?.numericValue),
    tbtMs: round(audits["total-blocking-time"]?.numericValue),
    speedIndexMs: round(audits["speed-index"]?.numericValue),
    ttfbMs: round(audits["server-response-time"]?.numericValue),
    fieldLcpMs: num(field.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
    fieldInpMs: num(field.INTERACTION_TO_NEXT_PAINT?.percentile),
    fieldCls: fieldClsRaw != null ? Math.round(fieldClsRaw) / 100 : null,
    fieldOverall: data.loadingExperience?.overall_category ?? null,
  };
}

function round(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n);
}
function round2(v: unknown): number | null {
  const n = num(v);
  return n == null ? null : Math.round(n * 1000) / 1000;
}

/**
 * Upsert one report row. Keyed by (ist_date, page_type, strategy) so a
 * re-run on the same day overwrites rather than duplicates.
 */
export async function writeCwvReport(report: CwvReport): Promise<void> {
  if (!getPool()) return;
  try {
    await exec(
      `INSERT INTO cwv_reports (
         ist_date, page_type, strategy, url,
         performance_score, lcp_ms, cls, fcp_ms, tbt_ms, speed_index_ms,
         ttfb_ms, field_lcp_ms, field_inp_ms, field_cls, field_overall, error
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
       )
       ON CONFLICT (ist_date, page_type, strategy) DO UPDATE SET
         url = EXCLUDED.url,
         performance_score = EXCLUDED.performance_score,
         lcp_ms = EXCLUDED.lcp_ms,
         cls = EXCLUDED.cls,
         fcp_ms = EXCLUDED.fcp_ms,
         tbt_ms = EXCLUDED.tbt_ms,
         speed_index_ms = EXCLUDED.speed_index_ms,
         ttfb_ms = EXCLUDED.ttfb_ms,
         field_lcp_ms = EXCLUDED.field_lcp_ms,
         field_inp_ms = EXCLUDED.field_inp_ms,
         field_cls = EXCLUDED.field_cls,
         field_overall = EXCLUDED.field_overall,
         error = EXCLUDED.error`,
      [
        report.istDate,
        report.pageType,
        report.strategy,
        report.url,
        report.performanceScore,
        report.lcpMs,
        report.cls,
        report.fcpMs,
        report.tbtMs,
        report.speedIndexMs,
        report.ttfbMs,
        report.fieldLcpMs,
        report.fieldInpMs,
        report.fieldCls,
        report.fieldOverall,
        report.error,
      ],
    );
  } catch (err) {
    console.error(
      "[cwv] writeCwvReport failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * The newest report for each (page_type, strategy) combination — i.e.
 * up to 4 rows: home/mobile, home/desktop, article/mobile,
 * article/desktop. Used by the dashboard home page.
 */
export async function readLatestCwvReports(): Promise<CwvReport[]> {
  if (!getPool()) return [];
  try {
    // Newest row per (page_type, strategy) via Postgres DISTINCT ON.
    const rows = await sql<CwvRow>(
      `SELECT DISTINCT ON (page_type, strategy) *
         FROM cwv_reports
        ORDER BY page_type, strategy, ist_date DESC, created_at DESC`,
    );
    return rows.map(rowToReport);
  } catch (err) {
    console.error(
      "[cwv] readLatestCwvReports failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/** Delete reports older than the retention window (matches articles). */
export async function purgeCwvReportsOlderThan(
  cutoffIstDate: string,
): Promise<number> {
  if (!getPool()) return 0;
  try {
    return await exec(`DELETE FROM cwv_reports WHERE ist_date < $1`, [
      cutoffIstDate,
    ]);
  } catch (err) {
    console.error(
      "[cwv] purge failed:",
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

function rowToReport(r: CwvRow): CwvReport {
  return {
    istDate: r.ist_date,
    pageType: r.page_type,
    strategy: r.strategy,
    url: r.url,
    performanceScore: r.performance_score,
    lcpMs: r.lcp_ms,
    cls: r.cls,
    fcpMs: r.fcp_ms,
    tbtMs: r.tbt_ms,
    speedIndexMs: r.speed_index_ms,
    ttfbMs: r.ttfb_ms,
    fieldLcpMs: r.field_lcp_ms,
    fieldInpMs: r.field_inp_ms,
    fieldCls: r.field_cls,
    fieldOverall: r.field_overall,
    error: r.error,
    createdAt: r.created_at,
  };
}

// ---- Rating helpers (shared by the UI). Thresholds are Google's
//      official "good / needs-improvement / poor" cut-offs. ----

export type CwvRating = "good" | "ni" | "poor" | "none";

export function rate(
  metric: "lcp" | "inp" | "cls" | "fcp" | "tbt" | "ttfb" | "si" | "score",
  value: number | null,
): CwvRating {
  if (value == null) return "none";
  switch (metric) {
    case "lcp":
      return value <= 2500 ? "good" : value <= 4000 ? "ni" : "poor";
    case "inp":
      return value <= 200 ? "good" : value <= 500 ? "ni" : "poor";
    case "cls":
      return value <= 0.1 ? "good" : value <= 0.25 ? "ni" : "poor";
    case "fcp":
      return value <= 1800 ? "good" : value <= 3000 ? "ni" : "poor";
    case "tbt":
      return value <= 200 ? "good" : value <= 600 ? "ni" : "poor";
    case "ttfb":
      return value <= 800 ? "good" : value <= 1800 ? "ni" : "poor";
    case "si":
      return value <= 3400 ? "good" : value <= 5800 ? "ni" : "poor";
    case "score":
      return value >= 90 ? "good" : value >= 50 ? "ni" : "poor";
  }
}

// ---- PSI response & DB row shapes (only the bits we read) ----

type PsiAudit = { numericValue?: number };
type PsiResponse = {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, PsiAudit>;
  };
  loadingExperience?: {
    overall_category?: string;
    metrics?: Record<string, { percentile?: number }>;
  };
};

type CwvRow = {
  id: number;
  ist_date: string;
  page_type: CwvPageType;
  strategy: CwvStrategy;
  url: string;
  performance_score: number | null;
  lcp_ms: number | null;
  cls: number | null;
  fcp_ms: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
  ttfb_ms: number | null;
  field_lcp_ms: number | null;
  field_inp_ms: number | null;
  field_cls: number | null;
  field_overall: string | null;
  error: string | null;
  created_at: string;
};

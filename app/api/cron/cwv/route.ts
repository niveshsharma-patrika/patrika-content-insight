import { NextResponse } from "next/server";
import { isDbConfigured, sqlOne } from "@/lib/db";
import { istDateMinusDays, todayInIST } from "@/lib/dates";
import {
  fetchPsi,
  purgeCwvReportsOlderThan,
  writeCwvReport,
  type CwvPageType,
  type CwvReport,
  type CwvStrategy,
} from "@/lib/cwv";

/**
 * Daily Core Web Vitals cron.
 *
 *   • Triggered by Vercel Cron (vercel.json) once a day at 18:30 UTC,
 *     which is 00:00 Asia/Kolkata (midnight IST).
 *   • Authenticated via `Authorization: Bearer ${CRON_SECRET}` — same
 *     scheme as the hourly scrape cron, and likewise the only protected
 *     route the auth proxy lets through unauthenticated.
 *   • Measures two URLs — the Patrika homepage and the latest published
 *     article — on BOTH mobile and desktop (4 PSI calls), storing one
 *     row per (page, strategy) in `cwv_reports`.
 *   • Enforces the same 7-day retention as articles.
 *
 * PSI calls are slow (10–30s each); we run the 4 concurrently and
 * tolerate per-call failures (recorded as a row with `error` set) so one
 * bad URL never sinks the whole run.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Vercel Pro

const HOMEPAGE_URL = "https://www.patrika.com";
const STRATEGIES: CwvStrategy[] = ["mobile", "desktop"];
const RETENTION_DAYS = 7;

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  // ---- Auth ----
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured on the server" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!isDbConfigured()) {
    return NextResponse.json({ ok: false, error: "DB not configured" }, { status: 500 });
  }

  const istDate = todayInIST();

  // ---- Pick the latest published article URL (ok scrapes only). ----
  const latest = await sqlOne<{ url: string }>(
    `SELECT url FROM articles
     WHERE ok = true
     ORDER BY published_at DESC NULLS LAST
     LIMIT 1`,
  );
  const articleUrl: string | null = latest?.url ?? null;

  // ---- Build the work list: homepage always; article when we have one. ----
  const targets: Array<{ pageType: CwvPageType; url: string }> = [
    { pageType: "home", url: HOMEPAGE_URL },
  ];
  if (articleUrl) targets.push({ pageType: "article", url: articleUrl });

  const jobs: Array<{ pageType: CwvPageType; strategy: CwvStrategy; url: string }> = [];
  for (const t of targets) {
    for (const strategy of STRATEGIES) {
      jobs.push({ pageType: t.pageType, strategy, url: t.url });
    }
  }

  // ---- Run all PSI calls concurrently, tolerate per-call failures. ----
  const settled = await Promise.allSettled(
    jobs.map(async (job): Promise<CwvReport> => {
      const metrics = await fetchPsi(job.url, job.strategy);
      return {
        istDate,
        pageType: job.pageType,
        strategy: job.strategy,
        url: job.url,
        error: null,
        ...metrics,
      };
    }),
  );

  let stored = 0;
  let failed = 0;
  for (let i = 0; i < settled.length; i++) {
    const job = jobs[i];
    const r = settled[i];
    if (r.status === "fulfilled") {
      await writeCwvReport(r.value);
      stored += 1;
    } else {
      failed += 1;
      const message =
        r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn(`[cron-cwv] ${job.pageType}/${job.strategy} failed:`, message);
      // Record the failure so the dashboard can show "couldn't measure".
      await writeCwvReport({
        istDate,
        pageType: job.pageType,
        strategy: job.strategy,
        url: job.url,
        error: message.slice(0, 300),
        performanceScore: null,
        lcpMs: null,
        cls: null,
        fcpMs: null,
        tbtMs: null,
        speedIndexMs: null,
        ttfbMs: null,
        fieldLcpMs: null,
        fieldInpMs: null,
        fieldCls: null,
        fieldOverall: null,
      });
    }
  }

  // ---- 7-day retention. ----
  const cutoff = istDateMinusDays(RETENTION_DAYS);
  const purged = await purgeCwvReportsOlderThan(cutoff);

  return NextResponse.json({
    ok: true,
    istDate,
    homepage: HOMEPAGE_URL,
    articleUrl,
    measured: jobs.length,
    stored,
    failed,
    purged,
  });
}

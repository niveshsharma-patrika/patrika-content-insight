import { NextResponse } from "next/server";
import { fetchSitemap } from "@/lib/sitemap";
import { todayInIST, istDateMinusDays } from "@/lib/dates";
import { scrapeArticle } from "@/lib/scraper";
import {
  getLatestPublishedAt,
  purgeArticlesOlderThan,
  writeArticle,
} from "@/lib/articleStore";
import { getDb } from "@/lib/db";
import { checkSlugsWithGemini } from "@/lib/gemini";
import { ensureUsersForBylines, findUsersForBylines } from "@/lib/users";
import { runRules } from "@/lib/rules";
import { buildAuthorAlert, sendTelegramMessage } from "@/lib/telegram";
import { getConfig } from "@/lib/config";
import {
  purgeCronRunsOlderThan,
  purgeSnapshotsOlderThan,
  writeDailySnapshot,
} from "@/lib/dashboardStats";
import type { ScrapedArticle, SitemapEntry } from "@/lib/types";

const RETENTION_DAYS = 7;

/**
 * Hourly cron entrypoint.
 *
 *   • Triggered by Vercel Cron (vercel.json) once an hour.
 *   • Authenticated via the `Authorization: Bearer ${CRON_SECRET}` header.
 *   • Reads max(published_at) from `articles` and only scrapes sitemap
 *     entries published AFTER that watermark. Older entries are skipped.
 *   • If the table is empty, falls back to "start of today (IST)" — so the
 *     first run picks up today's news only, never the entire 7-day backlog.
 *   • Locks via the `cron_runs` table — overlapping ticks no-op.
 *   • Hard cap of MAX_PER_RUN to keep a single tick under Vercel's 5-min
 *     hobby/pro function timeout.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes — Vercel Pro

const CONCURRENCY = 12;
const MAX_PER_RUN = 200; // safety net so one tick never runs forever
const LOCK_STALE_MIN = 30; // a "running" row older than this is considered crashed

type CronRunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  scraped: number | null;
  re_scraped: number | null;
  errors: number | null;
  status: string | null;
  notes: string | null;
};

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

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { ok: false, error: "DB not configured" },
      { status: 500 },
    );
  }

  // ---- Lock: skip if another run is already in flight ----
  const lockCutoff = new Date(
    Date.now() - LOCK_STALE_MIN * 60 * 1000,
  ).toISOString();
  const { data: liveRuns } = await db
    .from("cron_runs")
    .select("*")
    .eq("status", "running")
    .gte("started_at", lockCutoff);
  if (liveRuns && liveRuns.length > 0) {
    return NextResponse.json({
      ok: true,
      status: "skipped",
      reason: "another run already in progress",
    });
  }

  // ---- Insert "running" row ----
  const { data: runRow, error: runErr } = await db
    .from("cron_runs")
    .insert({ status: "running" })
    .select("*")
    .single();
  if (runErr || !runRow) {
    return NextResponse.json(
      { ok: false, error: runErr?.message ?? "could not start run" },
      { status: 500 },
    );
  }
  const runId = (runRow as CronRunRow).id;

  let scraped = 0;
  let errors = 0;
  let cutoffUsed: string;

  try {
    // ---- Compute the cutoff ----
    const lastSeen = await getLatestPublishedAt();
    cutoffUsed =
      lastSeen ?? `${todayInIST()}T00:00:00+05:30`;

    // ---- Fetch sitemap, diff against cutoff ----
    const all = await fetchSitemap({ forceRefresh: true });

    // Roll up "Patrika published N today" so the dashboard can read it
    // without ever fetching the sitemap itself.
    const istToday = todayInIST();
    const todaysCount = all.filter((e) =>
      (e.publishedAt ?? "").startsWith(istToday),
    ).length;
    try {
      await writeDailySnapshot(istToday, todaysCount);
    } catch (e) {
      console.warn(
        "[cron] daily snapshot write failed:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // ---- Enforce 7-day retention.
    //      Run unconditionally — even on quiet ticks where nothing new
    //      is published, we still want yesterday-minus-7 to roll off.
    //      `articles` cascade-deletes article_scores + rule_results.
    const purgeCutoff = istDateMinusDays(RETENTION_DAYS);
    let purgedArticles = 0;
    let purgedSnapshots = 0;
    let purgedRuns = 0;
    try {
      [purgedArticles, purgedSnapshots, purgedRuns] = await Promise.all([
        purgeArticlesOlderThan(purgeCutoff),
        purgeSnapshotsOlderThan(purgeCutoff),
        purgeCronRunsOlderThan(purgeCutoff),
      ]);
    } catch (e) {
      console.warn(
        "[cron] retention purge failed:",
        e instanceof Error ? e.message : String(e),
      );
    }

    // Compare as numeric timestamps, not strings — `getLatestPublishedAt`
    // returns a UTC string from Postgres (`...+00:00`) while the sitemap
    // gives us IST (`...+05:30`). String compare gets the wrong answer
    // when the timezones don't match, so we coerce both to ms.
    const cutoffMs = new Date(cutoffUsed).getTime();
    const fresh = all
      .filter((e) => {
        const ms = new Date(e.publishedAt ?? "").getTime();
        return Number.isFinite(ms) && ms > cutoffMs;
      })
      // newest first → oldest last; we slice MAX_PER_RUN from the top so a
      // big backlog gets drained over multiple ticks
      .slice(0, MAX_PER_RUN);

    if (fresh.length === 0) {
      await db
        .from("cron_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          scraped: 0,
          errors: 0,
          notes: `No new articles since ${cutoffUsed} · sitemap-today ${todaysCount} · purged ${purgedArticles}a/${purgedSnapshots}s/${purgedRuns}r`,
        })
        .eq("id", runId);
      return NextResponse.json({
        ok: true,
        status: "success",
        cutoff: cutoffUsed,
        sitemapToday: todaysCount,
        scraped: 0,
        errors: 0,
        purged: {
          articles: purgedArticles,
          snapshots: purgedSnapshots,
          cronRuns: purgedRuns,
        },
      });
    }

    // ---- Scrape concurrently ----
    const successfulScrapes: Array<{
      url: string;
      entry: SitemapEntry;
      article: ScrapedArticle;
    }> = [];
    const successfulBylines: Array<string | undefined> = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, fresh.length) }).map(
      async () => {
        while (true) {
          const i = cursor++;
          if (i >= fresh.length) return;
          const entry = fresh[i];
          try {
            const article = await scrapeArticle(entry.url);
            if (article.ok) {
              await writeArticle(entry.url, article, {
                title: entry.title,
                publishedAt: entry.publishedAt,
              });
              successfulScrapes.push({ url: entry.url, entry, article });
              successfulBylines.push(article.author);
              scraped += 1;
            } else {
              errors += 1;
            }
          } catch (e) {
            console.error("[cron] scrape failed:", entry.url, e);
            errors += 1;
          }
        }
      },
    );
    await Promise.all(workers);

    const successfulUrls = successfulScrapes.map((s) => s.url);

    // ---- Auto-import authors from bylines.
    //      Anyone we've never seen before becomes a new app_users row
    //      with the byline as their name + only alias. The editor then
    //      adds the Telegram chat ID via Settings.
    let usersCreated = 0;
    if (successfulBylines.length > 0) {
      try {
        const r = await ensureUsersForBylines(successfulBylines);
        usersCreated = r.created;
      } catch (e) {
        console.warn(
          "[cron] author auto-import skipped:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // ---- Run Gemini slug analysis on the freshly scraped URLs.
    //      The verdicts feed the `url-slug-english-only` rule. Gemini
    //      itself caches per-slug, so re-runs on already-judged slugs are
    //      free. If the API key is missing, this silently no-ops.
    let slugsAnalyzed = 0;
    let slugVerdictMap: Record<string, import("@/lib/types").SlugVerdict> = {};
    if (successfulUrls.length > 0) {
      try {
        slugVerdictMap = await checkSlugsWithGemini(successfulUrls);
        slugsAnalyzed = Object.keys(slugVerdictMap).length;
      } catch (e) {
        // Don't fail the whole cron run because Gemini hiccuped or the
        // key isn't set — articles are saved either way, the rule will
        // just show "no verdict yet" for those slugs until next tick.
        console.warn(
          "[cron] gemini slug analysis skipped:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // ---- Auto-nudge low-scoring articles.
    //      For each freshly scraped article, run the rules → compute
    //      editorial score → if < 80 AND the byline maps to a user with
    //      a Telegram chat ID → send the message right then.
    //      Telegram failures are logged but don't fail the cron.
    let nudgesSent = 0;
    let nudgesSkipped = 0;
    const cfg = await getConfig();
    if (cfg.telegramBotToken && successfulScrapes.length > 0) {
      // Bulk-resolve byline → user once, instead of one DB call per article.
      const bylines = successfulScrapes.map((s) => s.article.author);
      const matchedUsers = await findUsersForBylines(bylines);

      for (let i = 0; i < successfulScrapes.length; i++) {
        const { entry, article, url } = successfulScrapes[i];
        const user = matchedUsers[i];

        // Apply slug verdict if Gemini gave us one — keeps the score
        // honest about URL-slug issues.
        if (slugVerdictMap[url]) article.slugVerdict = slugVerdictMap[url];

        // Compute the editorial score the same way the dashboard does:
        // weighted pass-rate over editorial-scope rules only.
        const results = runRules(article, entry);
        let earned = 0;
        let total = 0;
        for (const r of results) {
          if (r.rule.scope !== "editorial") continue;
          const w =
            r.rule.severity === "error"
              ? 3
              : r.rule.severity === "warning"
                ? 2
                : 1;
          total += w;
          if (r.result.passed) earned += w;
        }
        const editorialScore = total > 0 ? Math.round((earned / total) * 100) : 0;

        if (editorialScore >= 80) {
          nudgesSkipped += 1;
          continue;
        }
        if (!user || !user.active || !user.telegramChatId) {
          nudgesSkipped += 1;
          continue;
        }

        const topIssues = results
          .filter((r) => !r.result.passed && r.rule.scope === "editorial")
          .sort(
            (x, y) =>
              (y.rule.severity === "error"
                ? 3
                : y.rule.severity === "warning"
                  ? 2
                  : 1) -
              (x.rule.severity === "error"
                ? 3
                : x.rule.severity === "warning"
                  ? 2
                  : 1),
          )
          .slice(0, 4)
          .map((r) => ({ title: r.rule.title, message: r.result.message }));

        try {
          await sendTelegramMessage(
            user.telegramChatId,
            buildAuthorAlert({
              authorName: user.name,
              headline: article.title || entry.title || "(untitled)",
              url,
              editorialScore,
              topIssues,
            }),
          );
          nudgesSent += 1;
        } catch (err) {
          console.warn(
            "[cron] telegram nudge failed:",
            url,
            "→",
            err instanceof Error ? err.message : String(err),
          );
          nudgesSkipped += 1;
        }
      }
    }

    // ---- Mark success ----
    await db
      .from("cron_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        scraped,
        errors,
        notes: `Cutoff ${cutoffUsed} · ${fresh.length} cand · ${slugsAnalyzed} slugs · ${usersCreated} authors · ${nudgesSent}/${nudgesSent + nudgesSkipped} nudges · purged ${purgedArticles}a/${purgedSnapshots}s/${purgedRuns}r`,
      })
      .eq("id", runId);

    return NextResponse.json({
      ok: true,
      status: "success",
      cutoff: cutoffUsed,
      candidates: fresh.length,
      scraped,
      slugsAnalyzed,
      usersCreated,
      nudgesSent,
      nudgesSkipped,
      errors,
      purged: {
        articles: purgedArticles,
        snapshots: purgedSnapshots,
        cronRuns: purgedRuns,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db
      .from("cron_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        scraped,
        errors,
        notes: msg.slice(0, 500),
      })
      .eq("id", runId);
    return NextResponse.json(
      { ok: false, error: msg, scraped, errors },
      { status: 500 },
    );
  }
}

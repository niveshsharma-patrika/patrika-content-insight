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
import { listEditors } from "@/lib/editors";
import { ensureSectionsForUrls } from "@/lib/sections";
import { runRules } from "@/lib/rules";
import { getDisabledRuleIds } from "@/lib/ruleSettings";
import { buildAuthorAlert, buildSeoAlert, sendTelegramMessage } from "@/lib/telegram";
import { getConfig } from "@/lib/config";
import {
  purgeCronRunsOlderThan,
  purgeSnapshotsOlderThan,
  updateDailySnapshotAggregates,
  writeDailySnapshot,
} from "@/lib/dashboardStats";
import { getCachedDashboardStats } from "@/lib/analyze";
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

  // ---- Sweep stale 'running' rows from crashed previous ticks.
  //      Without this, a tick that was killed mid-run leaves a
  //      'running' row forever — the dashboard reports it as the
  //      "last cron tick" and editors think the cron is healthy.
  const lockCutoff = new Date(
    Date.now() - LOCK_STALE_MIN * 60 * 1000,
  ).toISOString();
  await db
    .from("cron_runs")
    .update({
      status: "crashed",
      finished_at: new Date().toISOString(),
      notes: "[stale running row swept on next-tick lock check]",
    })
    .eq("status", "running")
    .lt("started_at", lockCutoff);

  // ---- Lock: insert a fresh 'running' row.
  //      A unique partial index (idx_cron_runs_only_one_running) makes
  //      this fail with a duplicate-key error if another tick already
  //      holds the lock, eliminating the TOCTOU race. We translate
  //      that error into a 'skipped' response so two simultaneous
  //      cron firings never both proceed to scrape and message.
  const { data: runRow, error: runErr } = await db
    .from("cron_runs")
    .insert({ status: "running" })
    .select("*")
    .single();
  if (runErr || !runRow) {
    const msg = runErr?.message ?? "could not start run";
    // Postgres unique-violation = 23505. Supabase surfaces it via the
    // error code or a message containing "duplicate key". Any of those
    // means we lost the lock race — that's fine, the other tick is
    // doing the work.
    const isDup =
      runErr?.code === "23505" ||
      /duplicate key|unique constraint/i.test(msg);
    if (isDup) {
      return NextResponse.json({
        ok: true,
        status: "skipped",
        reason: "another run already in progress",
      });
    }
    return NextResponse.json(
      { ok: false, error: msg },
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
    const candidates = all.filter((e) => {
      const ms = new Date(e.publishedAt ?? "").getTime();
      return Number.isFinite(ms) && ms > cutoffMs;
    });
    // Drain OLDEST-first when the backlog exceeds MAX_PER_RUN. The
    // sitemap is sorted newest-first; if we sliced the top MAX_PER_RUN
    // we'd advance the watermark to the newest item, leaving everything
    // between the old watermark and the slice permanently un-scraped on
    // the next tick. Taking the oldest MAX_PER_RUN advances the
    // watermark only as far as the newest item we actually processed,
    // so the next tick correctly picks up the rest.
    const fresh =
      candidates.length > MAX_PER_RUN
        ? candidates.slice(-MAX_PER_RUN)
        : candidates;

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

    // ---- Auto-import sections from URLs.
    //      Each article's url-slug first segment becomes a row in
    //      `sections` (title-cased display name). Re-runs are cheap —
    //      known ids just get last_seen_at bumped.
    let sectionsCreated = 0;
    if (successfulUrls.length > 0) {
      try {
        const r = await ensureSectionsForUrls(successfulUrls);
        sectionsCreated = r.created;
      } catch (e) {
        console.warn(
          "[cron] section auto-import skipped:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

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
    let geminiError: string | null = null;
    if (successfulUrls.length > 0) {
      try {
        slugVerdictMap = await checkSlugsWithGemini(successfulUrls);
        slugsAnalyzed = Object.keys(slugVerdictMap).length;
      } catch (e) {
        // Don't fail the whole cron run because Gemini hiccuped or the
        // key isn't set — articles are saved either way, the rule will
        // just show "no verdict yet" for those slugs until next tick.
        geminiError = e instanceof Error ? e.message : String(e);
        console.warn("[cron] gemini slug analysis skipped:", geminiError);
      }
    }

    // ---- Auto-nudge low-scoring articles.
    //      For each freshly scraped article we run rules → derive two
    //      independent scores → fan out to two independent recipient
    //      groups:
    //
    //        EDITORIAL TRACK (editorialScore < 80)
    //          - The matched author (if they have a chat ID),
    //          - Every active editor whose roles[] includes 'editorial'.
    //          Message: buildAuthorAlert (craft / writing feedback).
    //
    //        SEO TRACK (seoScore < 80)
    //          - Every active editor whose roles[] includes 'seo'.
    //          Message: buildSeoAlert (tech / infra feedback).
    //
    //      Tracks are independent — an article can trigger both, neither,
    //      or just one. Within a track, recipients are deduped by chat ID
    //      so the same person isn't double-messaged. Across tracks, a
    //      person with both roles will receive both messages (intentional —
    //      they explicitly opted into both alert types).
    //      Telegram failures are logged but don't fail the cron.
    let nudgesSent = 0;
    let nudgesSkipped = 0;
    const cfg = await getConfig();
    if (cfg.telegramBotToken && successfulScrapes.length > 0) {
      // Editor-controlled rule on/off switches. Fetched once for the
      // whole batch — same toggles apply to every article. Force a
      // fresh read so a toggle made in Settings reflects on the very
      // next cron tick, not 5 minutes later.
      const disabledRuleIds = await getDisabledRuleIds({ forceRefresh: true });
      // Bulk-resolve byline → user once, instead of one DB call per article.
      const bylines = successfulScrapes.map((s) => s.article.author);
      const matchedUsers = await findUsersForBylines(bylines);
      // Editors loaded once per tick. Split by role so we don't filter
      // 100 articles × N editors over and over.
      const allEditors = (await listEditors({ activeOnly: true })).filter(
        (e) => e.telegramChatId,
      );
      const editorialEditors = allEditors.filter((e) =>
        e.roles.includes("editorial"),
      );
      const seoEditors = allEditors.filter((e) => e.roles.includes("seo"));

      function weight(sev: "error" | "warning" | "info"): number {
        return sev === "error" ? 3 : sev === "warning" ? 2 : 1;
      }

      for (let i = 0; i < successfulScrapes.length; i++) {
        const { entry, article, url } = successfulScrapes[i];
        const user = matchedUsers[i];
        try {
          // Apply slug verdict if Gemini gave us one — keeps the score
          // honest about URL-slug issues.
          if (slugVerdictMap[url]) article.slugVerdict = slugVerdictMap[url];

          // Run the full rule set once and separate scope inline.
          const results = runRules(article, entry, disabledRuleIds);
          let editorialEarned = 0,
            editorialTotal = 0;
          let seoEarned = 0,
            seoTotal = 0;
          for (const r of results) {
            const w = weight(r.rule.severity);
            if (r.rule.scope === "editorial") {
              editorialTotal += w;
              if (r.result.passed) editorialEarned += w;
            } else if (r.rule.scope === "seo") {
              seoTotal += w;
              if (r.result.passed) seoEarned += w;
            }
          }
          const editorialScore =
            editorialTotal > 0
              ? Math.round((editorialEarned / editorialTotal) * 100)
              : 0;
          const seoScore =
            seoTotal > 0 ? Math.round((seoEarned / seoTotal) * 100) : 0;

          const headline = article.title || entry.title || "(untitled)";
          const authorName =
            user?.name ?? article.author?.trim() ?? "the author";

          // ===== EDITORIAL TRACK =====
          if (editorialScore < 80) {
            type Recipient = {
              chatId: string;
              name: string;
              forEditor: boolean;
            };
            const byChat = new Map<string, Recipient>();
            if (user && user.active && user.telegramChatId) {
              byChat.set(user.telegramChatId, {
                chatId: user.telegramChatId,
                name: user.name,
                forEditor: false,
              });
            }
            for (const ed of editorialEditors) {
              if (byChat.has(ed.telegramChatId)) continue; // dedup
              byChat.set(ed.telegramChatId, {
                chatId: ed.telegramChatId,
                name: ed.name,
                forEditor: true,
              });
            }
            if (byChat.size > 0) {
              const topIssues = results
                .filter(
                  (r) => !r.result.passed && r.rule.scope === "editorial",
                )
                .sort(
                  (x, y) => weight(y.rule.severity) - weight(x.rule.severity),
                )
                .slice(0, 4)
                .map((r) => ({
                  title: r.rule.title,
                  message: r.result.message,
                }));
              for (const r of byChat.values()) {
                try {
                  await sendTelegramMessage(
                    r.chatId,
                    buildAuthorAlert({
                      authorName,
                      headline,
                      url,
                      editorialScore,
                      topIssues,
                      forEditor: r.forEditor,
                      editorName: r.forEditor ? r.name : undefined,
                    }),
                  );
                  nudgesSent += 1;
                } catch (err) {
                  console.warn(
                    "[cron] editorial nudge failed:",
                    url,
                    "→",
                    err instanceof Error ? err.message : String(err),
                  );
                  nudgesSkipped += 1;
                }
              }
            } else {
              // Score is bad but no author chat ID and no editorial-role
              // editors configured. Nothing to send.
              nudgesSkipped += 1;
            }
          }

          // ===== SEO TRACK =====
          if (seoScore < 80 && seoEditors.length > 0) {
            const topSeoIssues = results
              .filter((r) => !r.result.passed && r.rule.scope === "seo")
              .sort(
                (x, y) => weight(y.rule.severity) - weight(x.rule.severity),
              )
              .slice(0, 5)
              .map((r) => ({
                title: r.rule.title,
                message: r.result.message,
              }));
            // Dedup within the SEO recipient list (same person can't be in
            // seoEditors twice, but guard anyway).
            const seenChats = new Set<string>();
            for (const ed of seoEditors) {
              if (seenChats.has(ed.telegramChatId)) continue;
              seenChats.add(ed.telegramChatId);
              try {
                await sendTelegramMessage(
                  ed.telegramChatId,
                  buildSeoAlert({
                    recipientName: ed.name,
                    headline,
                    url,
                    seoScore,
                    topIssues: topSeoIssues,
                  }),
                );
                nudgesSent += 1;
              } catch (err) {
                console.warn(
                  "[cron] seo nudge failed:",
                  url,
                  "→",
                  err instanceof Error ? err.message : String(err),
                );
                nudgesSkipped += 1;
              }
            }
          } else if (seoScore < 80) {
            // Score is bad but no SEO-role editors configured.
            nudgesSkipped += 1;
          }

          // If both scores were ≥80, nothing fires — count as skipped so
          // the cron-run summary shows the article was inspected.
          if (editorialScore >= 80 && seoScore >= 80) {
            nudgesSkipped += 1;
          }
        } catch (perArticleErr) {
          // A single bad article (e.g. runRules throws on a malformed
          // payload) must not abort the rest of the batch. Log + skip.
          console.warn(
            "[cron] auto-nudge step failed for one article:",
            url,
            "→",
            perArticleErr instanceof Error
              ? perArticleErr.message
              : String(perArticleErr),
          );
          nudgesSkipped += 1;
        }
      }
    }

    // ---- Daily-issues aggregate for the trend graph.
    //      Recompute the whole day's error/warning totals + average
    //      scores from stored articles and fold them into today's
    //      daily_snapshots row. Cheap (one day's analysis) and keeps the
    //      home-page graph populated going forward. Never fails the run.
    try {
      const dayStats = await getCachedDashboardStats({ date: istToday });
      if (dayStats) {
        await updateDailySnapshotAggregates(istToday, {
          analyzed: dayStats.analyzed,
          errors: dayStats.errors,
          warnings: dayStats.warnings,
          avgEditorialScore: dayStats.averageEditorialScore,
          avgSeoScore: dayStats.averageSeoScore,
        });
      }
    } catch (aggErr) {
      console.warn(
        "[cron] daily aggregate update failed:",
        aggErr instanceof Error ? aggErr.message : String(aggErr),
      );
    }

    // ---- Mark success ----
    await db
      .from("cron_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        scraped,
        errors,
        notes: `Cutoff ${cutoffUsed} · ${fresh.length} cand · ${slugsAnalyzed} slugs${geminiError ? ` (gemini-err: ${geminiError.slice(0, 120)})` : ""} · ${usersCreated} authors · ${sectionsCreated} sections · ${nudgesSent}/${nudgesSent + nudgesSkipped} nudges · purged ${purgedArticles}a/${purgedSnapshots}s/${purgedRuns}r`,
      })
      .eq("id", runId);

    return NextResponse.json({
      ok: true,
      status: "success",
      cutoff: cutoffUsed,
      candidates: fresh.length,
      scraped,
      slugsAnalyzed,
      geminiError,
      usersCreated,
      sectionsCreated,
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

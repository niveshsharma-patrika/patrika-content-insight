import { getDb } from "./db";

/**
 * Per-day rolled-up stats. Written by the cron at the end of each tick
 * and read by the dashboard so the home page never has to touch the
 * live sitemap.
 *
 * Right now we only track `total_articles` (Patrika's published-count
 * for that IST date). Average scores, error/warning totals etc. are
 * already in the schema and can be filled in later.
 */

export type DailySnapshot = {
  date: string; // YYYY-MM-DD
  totalArticles: number | null;
};

export async function readDailySnapshot(
  istDate: string,
): Promise<DailySnapshot | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from("daily_snapshots")
    .select("date,total_articles")
    .eq("date", istDate)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { date: string; total_articles: number | null };
  return { date: row.date, totalArticles: row.total_articles };
}

/**
 * Drop snapshot rows for IST dates strictly before `cutoffIstDate`.
 * Called by the cron alongside the article purge so the two stay in
 * sync (no orphan stat rows for purged days).
 */
export async function purgeSnapshotsOlderThan(
  cutoffIstDate: string,
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const { error, count } = await db
    .from("daily_snapshots")
    .delete({ count: "exact" })
    .lt("date", cutoffIstDate);
  if (error) {
    console.error(
      "[dashboardStats.purgeSnapshotsOlderThan] failed:",
      error.message,
    );
    return 0;
  }
  return count ?? 0;
}

/**
 * Trim cron-run history. Hourly ticks add 24/day, so even at the
 * 7-day window we keep < 200 rows — kept for diagnostic value.
 */
export async function purgeCronRunsOlderThan(
  cutoffIstDate: string,
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const cutoffIso = `${cutoffIstDate}T00:00:00+05:30`;
  const { error, count } = await db
    .from("cron_runs")
    .delete({ count: "exact" })
    .lt("started_at", cutoffIso);
  if (error) {
    console.error(
      "[dashboardStats.purgeCronRunsOlderThan] failed:",
      error.message,
    );
    return 0;
  }
  return count ?? 0;
}

export async function writeDailySnapshot(
  istDate: string,
  totalArticles: number,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { error } = await db
    .from("daily_snapshots")
    .upsert(
      { date: istDate, total_articles: totalArticles },
      { onConflict: "date" },
    );
  if (error) {
    console.error(
      "[dashboardStats.writeDailySnapshot] upsert failed:",
      error.message,
    );
  }
}

/**
 * Latest cron-run row, used in the header to show "last tick: N min ago".
 */
export type LastCronRun = {
  startedAt: string;
  finishedAt: string | null;
  status: string | null;
  scraped: number | null;
  errors: number | null;
};

/**
 * Recent cron-run rows, newest-first. Used by Settings → Cron history
 * to show the editor when the cron actually fired and what each tick
 * did. The default limit covers ~2 days at hourly cadence.
 */
export type CronRunRow = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  scraped: number | null;
  errors: number | null;
  status: string | null;
  notes: string | null;
};

export async function listCronRuns(limit: number = 50): Promise<CronRunRow[]> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from("cron_runs")
    .select("id,started_at,finished_at,scraped,errors,status,notes")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Array<{
    id: number;
    started_at: string;
    finished_at: string | null;
    scraped: number | null;
    errors: number | null;
    status: string | null;
    notes: string | null;
  }>).map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    scraped: r.scraped,
    errors: r.errors,
    status: r.status,
    notes: r.notes,
  }));
}

export async function readLastCronRun(): Promise<LastCronRun | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from("cron_runs")
    .select("started_at,finished_at,status,scraped,errors")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as {
    started_at: string;
    finished_at: string | null;
    status: string | null;
    scraped: number | null;
    errors: number | null;
  };
  return {
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    scraped: r.scraped,
    errors: r.errors,
  };
}

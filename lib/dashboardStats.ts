import { sql, sqlOne, exec, getPool } from "./db";

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
  analyzed: number | null;
  totalErrors: number | null;
  totalWarnings: number | null;
  avgEditorialScore: number | null;
  avgSeoScore: number | null;
};

type SnapshotRow = {
  date: string;
  total_articles: number | null;
  analyzed?: number | null;
  total_errors: number | null;
  total_warnings: number | null;
  avg_editorial_score: number | null;
  avg_seo_score: number | null;
};

function rowToSnapshot(row: SnapshotRow): DailySnapshot {
  return {
    date: row.date,
    totalArticles: row.total_articles,
    analyzed: row.analyzed ?? null,
    totalErrors: row.total_errors,
    totalWarnings: row.total_warnings,
    avgEditorialScore: row.avg_editorial_score,
    avgSeoScore: row.avg_seo_score,
  };
}

const SNAPSHOT_COLS =
  "date,total_articles,total_errors,total_warnings,avg_editorial_score,avg_seo_score";

export async function readDailySnapshot(
  istDate: string,
): Promise<DailySnapshot | null> {
  if (!getPool()) return null;
  const row = await sqlOne<SnapshotRow>(
    `SELECT ${SNAPSHOT_COLS} FROM daily_snapshots WHERE date = $1`,
    [istDate],
  );
  if (!row) return null;
  return rowToSnapshot(row);
}

/**
 * The most recent `limit` daily snapshots, OLDEST-first (chart-ready).
 * Powers the home-page daily-issues trend graph.
 */
export async function readRecentSnapshots(
  limit: number = 7,
): Promise<DailySnapshot[]> {
  if (!getPool()) return [];
  const rows = await sql<SnapshotRow>(
    `SELECT ${SNAPSHOT_COLS} FROM daily_snapshots
     ORDER BY date DESC LIMIT $1`,
    [limit],
  );
  return rows.map(rowToSnapshot).reverse();
}

/**
 * Fill in the per-day issue aggregates computed from the day's stored
 * articles. Called at the end of each scrape-cron tick. Uses .update()
 * (not upsert) so it never clobbers the total_articles written earlier
 * in the same tick — the row is guaranteed to exist by then.
 */
export async function updateDailySnapshotAggregates(
  istDate: string,
  agg: {
    analyzed: number;
    errors: number;
    warnings: number;
    avgEditorialScore: number;
    avgSeoScore: number;
  },
): Promise<void> {
  if (!getPool()) return;
  try {
    await exec(
      `UPDATE daily_snapshots SET
         total_errors = $1,
         total_warnings = $2,
         avg_editorial_score = $3,
         avg_seo_score = $4
       WHERE date = $5`,
      [
        agg.errors,
        agg.warnings,
        agg.avgEditorialScore,
        agg.avgSeoScore,
        istDate,
      ],
    );
  } catch (err) {
    console.error(
      "[dashboardStats.updateDailySnapshotAggregates] failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Drop snapshot rows for IST dates strictly before `cutoffIstDate`.
 * Called by the cron alongside the article purge so the two stay in
 * sync (no orphan stat rows for purged days).
 */
export async function purgeSnapshotsOlderThan(
  cutoffIstDate: string,
): Promise<number> {
  if (!getPool()) return 0;
  try {
    return await exec(`DELETE FROM daily_snapshots WHERE date < $1`, [
      cutoffIstDate,
    ]);
  } catch (err) {
    console.error(
      "[dashboardStats.purgeSnapshotsOlderThan] failed:",
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

/**
 * Trim cron-run history. Hourly ticks add 24/day, so even at the
 * 7-day window we keep < 200 rows — kept for diagnostic value.
 */
export async function purgeCronRunsOlderThan(
  cutoffIstDate: string,
): Promise<number> {
  if (!getPool()) return 0;
  const cutoffIso = `${cutoffIstDate}T00:00:00+05:30`;
  try {
    return await exec(`DELETE FROM cron_runs WHERE started_at < $1`, [
      cutoffIso,
    ]);
  } catch (err) {
    console.error(
      "[dashboardStats.purgeCronRunsOlderThan] failed:",
      err instanceof Error ? err.message : String(err),
    );
    return 0;
  }
}

export async function writeDailySnapshot(
  istDate: string,
  totalArticles: number,
): Promise<void> {
  if (!getPool()) return;
  try {
    await exec(
      `INSERT INTO daily_snapshots (date, total_articles)
       VALUES ($1, $2)
       ON CONFLICT (date) DO UPDATE SET
         total_articles = EXCLUDED.total_articles`,
      [istDate, totalArticles],
    );
  } catch (err) {
    console.error(
      "[dashboardStats.writeDailySnapshot] upsert failed:",
      err instanceof Error ? err.message : String(err),
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
  if (!getPool()) return [];
  const rows = await sql<{
    id: number;
    started_at: string;
    finished_at: string | null;
    scraped: number | null;
    errors: number | null;
    status: string | null;
    notes: string | null;
  }>(
    `SELECT id,started_at,finished_at,scraped,errors,status,notes
     FROM cron_runs
     ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    scraped: r.scraped,
    errors: r.errors,
    status: r.status,
    notes: r.notes,
  }));
}

/**
 * Most recent TERMINAL cron-run row (success / failed / skipped /
 * crashed). The header's "last cron tick" indicator should reflect
 * the last known-finished run, not a row that's still in flight (or
 * stuck running) — otherwise a hung tick gets mistaken for a healthy
 * one.
 */
export async function readLastCronRun(): Promise<LastCronRun | null> {
  if (!getPool()) return null;
  const r = await sqlOne<{
    started_at: string;
    finished_at: string | null;
    status: string | null;
    scraped: number | null;
    errors: number | null;
  }>(
    `SELECT started_at,finished_at,status,scraped,errors
     FROM cron_runs
     WHERE status <> 'running'
     ORDER BY started_at DESC LIMIT 1`,
  );
  if (!r) return null;
  return {
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    scraped: r.scraped,
    errors: r.errors,
  };
}

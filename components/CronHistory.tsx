import type { CronRunRow } from "@/lib/dashboardStats";
import { formatRelative } from "@/lib/utils";

/**
 * Read-only list of recent cron runs. Server-rendered. The editor uses
 * this to confirm the cron is actually firing and to spot failed ticks.
 * Retention is 7 days (the cron purges its own old rows).
 */
export function CronHistory({ runs }: { runs: CronRunRow[] }) {
  const successCount = runs.filter((r) => r.status === "success").length;
  const failedCount = runs.filter((r) => r.status === "failed").length;
  const skippedCount = runs.filter((r) => r.status === "skipped").length;

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <header className="px-5 py-3 border-b bg-stone-50/60">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Cron history</h2>
          <span className="text-[11px] text-muted">
            {runs.length} run{runs.length === 1 ? "" : "s"} · {successCount}{" "}
            ok
            {failedCount > 0 ? (
              <>
                {" · "}
                <span className="text-red-700">{failedCount} failed</span>
              </>
            ) : null}
            {skippedCount > 0 ? (
              <>
                {" · "}
                <span className="text-amber-700">{skippedCount} skipped</span>
              </>
            ) : null}
          </span>
        </div>
        <p className="text-xs text-muted mt-1">
          Hourly Vercel cron — diff-scrapes the sitemap, runs Gemini,
          auto-imports authors and sections, and nudges low-scoring
          articles. Kept for 7 days.
        </p>
      </header>

      {runs.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No cron runs recorded yet. The first tick fires at the top of
          the next hour in production.
        </p>
      ) : (
        <ul className="divide-y">
          {runs.map((r) => {
            const tone =
              r.status === "success"
                ? "text-emerald-700"
                : r.status === "failed"
                  ? "text-red-700"
                  : r.status === "skipped"
                    ? "text-amber-700"
                    : r.status === "running"
                      ? "text-sky-700"
                      : "text-muted";
            const dot =
              r.status === "success"
                ? "bg-emerald-500"
                : r.status === "failed"
                  ? "bg-red-500"
                  : r.status === "skipped"
                    ? "bg-amber-500"
                    : r.status === "running"
                      ? "bg-sky-500 animate-pulse"
                      : "bg-stone-300";

            const durMs =
              r.finishedAt && r.startedAt
                ? new Date(r.finishedAt).getTime() -
                  new Date(r.startedAt).getTime()
                : null;
            const durStr =
              durMs === null
                ? null
                : durMs < 1000
                  ? `${durMs} ms`
                  : `${(durMs / 1000).toFixed(1)} s`;

            return (
              <li key={r.id} className="px-5 py-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className={`inline-block size-1.5 rounded-full ${dot}`}
                  />
                  <span
                    className={`text-xs font-medium uppercase tracking-wide ${tone}`}
                  >
                    {r.status ?? "unknown"}
                  </span>
                  <span
                    className="text-xs text-muted"
                    suppressHydrationWarning
                    title={r.startedAt}
                  >
                    {formatRelative(r.startedAt)}
                  </span>
                  {durStr ? (
                    <span className="text-[11px] text-muted font-mono tabular-nums">
                      {durStr}
                    </span>
                  ) : null}
                  <span className="text-[11px] text-muted ml-auto tabular-nums">
                    {r.scraped ?? 0} scraped
                    {(r.errors ?? 0) > 0 ? (
                      <>
                        {" · "}
                        <span className="text-red-700">
                          {r.errors} err
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
                {r.notes ? (
                  <div className="text-[11px] text-muted mt-1 font-mono break-all">
                    {r.notes}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

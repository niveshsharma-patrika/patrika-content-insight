import type { DailySnapshot } from "@/lib/dashboardStats";
import { dayChipLabel } from "@/lib/dates";

/**
 * Home-page daily-issues trend. Stacked bars (errors + warnings) per IST
 * day over the retention window, with the day's average editorial score
 * underneath. Data comes from `daily_snapshots`, which the scrape cron
 * fills in at the end of each tick. Server-rendered, no chart library.
 */
export function DailyIssuesChart({ snapshots }: { snapshots: DailySnapshot[] }) {
  // Only days that actually have aggregate data (the cron started
  // recording errors/warnings). Older rows may have nulls.
  const days = snapshots.filter(
    (s) => s.totalErrors != null || s.totalWarnings != null,
  );

  const maxTotal = Math.max(
    1,
    ...days.map((s) => (s.totalErrors ?? 0) + (s.totalWarnings ?? 0)),
  );

  const totalErrors = days.reduce((n, s) => n + (s.totalErrors ?? 0), 0);
  const totalWarnings = days.reduce((n, s) => n + (s.totalWarnings ?? 0), 0);

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <header className="px-5 py-3 border-b bg-stone-50/60 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold">Daily issues</h2>
          <p className="text-xs text-muted mt-1">
            Errors and warnings found across all analyzed articles, per day.
          </p>
        </div>
        {days.length > 0 ? (
          <div className="flex items-center gap-3 text-xs">
            <Legend className="bg-red-500" label={`${totalErrors.toLocaleString()} errors`} />
            <Legend className="bg-amber-400" label={`${totalWarnings.toLocaleString()} warnings`} />
          </div>
        ) : null}
      </header>

      {days.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No daily issue data yet. The hourly cron records error/warning
          totals at the end of each tick — the trend fills in from here.
        </p>
      ) : (
        <div className="px-5 py-5">
          <div className="flex items-end gap-2 sm:gap-3 h-44">
            {days.map((s) => {
              const errors = s.totalErrors ?? 0;
              const warnings = s.totalWarnings ?? 0;
              const total = errors + warnings;
              const errPct = (errors / maxTotal) * 100;
              const warnPct = (warnings / maxTotal) * 100;
              return (
                <div
                  key={s.date}
                  className="w-16 flex flex-col items-center gap-1.5 h-full justify-end"
                  title={`${dayChipLabel(s.date)} · ${errors} errors · ${warnings} warnings${
                    s.avgEditorialScore != null
                      ? ` · avg editorial ${s.avgEditorialScore}%`
                      : ""
                  }`}
                >
                  <span className="text-[10px] tabular-nums text-muted leading-none">
                    {total.toLocaleString()}
                  </span>
                  <div className="w-full max-w-[44px] flex flex-col justify-end flex-1">
                    {/* errors on top, warnings below */}
                    <div
                      className="w-full bg-red-500 rounded-t-sm"
                      style={{ height: `${errPct}%` }}
                    />
                    <div
                      className="w-full bg-amber-400"
                      style={{ height: `${warnPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* x-axis: day labels + avg editorial score */}
          <div className="flex items-start gap-2 sm:gap-3 mt-2 border-t pt-2">
            {days.map((s) => (
              <div key={s.date} className="w-16 text-center">
                <div className="text-[10px] text-muted leading-tight">
                  {dayChipLabel(s.date)}
                </div>
                {s.avgEditorialScore != null ? (
                  <div
                    className={`text-[11px] font-medium tabular-nums leading-tight ${
                      s.avgEditorialScore >= 80
                        ? "text-emerald-700"
                        : s.avgEditorialScore >= 60
                          ? "text-amber-700"
                          : "text-red-700"
                    }`}
                    title="Average editorial score"
                  >
                    {s.avgEditorialScore}%
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <span className={`inline-block size-2.5 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

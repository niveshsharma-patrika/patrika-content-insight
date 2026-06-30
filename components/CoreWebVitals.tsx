import { rate, type CwvRating, type CwvReport } from "@/lib/cwv";
import { dayChipLabel } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * Read-only Core Web Vitals panel for the dashboard home page.
 *
 * Renders the newest PSI report per page (homepage + latest article),
 * each with a mobile and desktop column. Lab metrics (Lighthouse) are
 * always shown; field metrics (CrUX real-user p75) appear when Google
 * has data for the URL. Measured nightly by /api/cron/cwv.
 */
export function CoreWebVitals({ reports }: { reports: CwvReport[] }) {
  const groups: Array<{ pageType: "home" | "article"; label: string }> = [
    { pageType: "home", label: "Homepage" },
    { pageType: "article", label: "Latest article" },
  ];

  const has = reports.length > 0;
  const lastRun = has
    ? reports.reduce((a, r) => (r.istDate > a ? r.istDate : a), reports[0].istDate)
    : null;

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <header className="px-5 py-3 border-b bg-stone-50/60 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold">Core Web Vitals</h2>
          <p className="text-xs text-muted mt-1">
            Measured nightly via Google PageSpeed Insights — homepage &amp;
            latest article, mobile &amp; desktop.
          </p>
        </div>
        {lastRun ? (
          <span className="text-xs text-muted">
            last run <span className="font-medium">{dayChipLabel(lastRun)}</span>
          </span>
        ) : null}
      </header>

      {!has ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No Core Web Vitals recorded yet. The daily cron runs at midnight
          IST and will populate this panel on its next tick.
        </p>
      ) : (
        <div className="divide-y">
          {groups.map((g) => {
            const mobile = reports.find(
              (r) => r.pageType === g.pageType && r.strategy === "mobile",
            );
            const desktop = reports.find(
              (r) => r.pageType === g.pageType && r.strategy === "desktop",
            );
            if (!mobile && !desktop) return null;
            const url = mobile?.url ?? desktop?.url ?? "";
            return (
              <div key={g.pageType} className="px-5 py-4 space-y-3">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <h3 className="text-sm font-semibold">{g.label}</h3>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-muted hover:underline truncate max-w-[60%]"
                    >
                      {url}
                    </a>
                  ) : null}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <StrategyCard label="Mobile" report={mobile} />
                  <StrategyCard label="Desktop" report={desktop} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StrategyCard({
  label,
  report,
}: {
  label: string;
  report?: CwvReport;
}) {
  return (
    <div className="rounded-lg border bg-stone-50/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted font-medium">
          {label}
        </span>
        {report ? (
          <ScorePill score={report.performanceScore} />
        ) : (
          <span className="text-xs text-muted">no data</span>
        )}
      </div>

      {report?.error ? (
        <p className="text-xs text-red-700">Couldn&apos;t measure: {report.error}</p>
      ) : report ? (
        <>
          {/* Lab metrics */}
          <div className="grid grid-cols-3 gap-2">
            <Metric name="LCP" rating={rate("lcp", report.lcpMs)} value={ms(report.lcpMs)} />
            <Metric name="CLS" rating={rate("cls", report.cls)} value={cls(report.cls)} />
            <Metric name="TBT" rating={rate("tbt", report.tbtMs)} value={ms(report.tbtMs)} />
            <Metric name="FCP" rating={rate("fcp", report.fcpMs)} value={ms(report.fcpMs)} />
            <Metric name="Speed Idx" rating={rate("si", report.speedIndexMs)} value={ms(report.speedIndexMs)} />
            <Metric name="TTFB" rating={rate("ttfb", report.ttfbMs)} value={ms(report.ttfbMs)} />
          </div>

          {/* Field (CrUX real-user) metrics, when present */}
          {report.fieldLcpMs != null ||
          report.fieldInpMs != null ||
          report.fieldCls != null ? (
            <div className="border-t pt-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
                Field (real users
                {report.fieldOverall ? ` · ${report.fieldOverall.toLowerCase()}` : ""})
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Metric name="LCP" rating={rate("lcp", report.fieldLcpMs)} value={ms(report.fieldLcpMs)} />
                <Metric name="INP" rating={rate("inp", report.fieldInpMs)} value={ms(report.fieldInpMs)} />
                <Metric name="CLS" rating={rate("cls", report.fieldCls)} value={cls(report.fieldCls)} />
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted border-t pt-2">
              No real-user field data for this URL.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted">Not measured.</p>
      )}
    </div>
  );
}

function ScorePill({ score }: { score: number | null }) {
  const r = rate("score", score);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-sm font-semibold tabular-nums w-9 h-9 border",
        ratingClasses(r),
      )}
    >
      {score ?? "—"}
    </span>
  );
}

function Metric({
  name,
  value,
  rating,
}: {
  name: string;
  value: string;
  rating: CwvRating;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-muted">{name}</div>
      <div
        className={cn(
          "text-xs font-mono font-medium tabular-nums px-1.5 py-0.5 rounded border inline-block",
          ratingClasses(rating),
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ratingClasses(r: CwvRating): string {
  switch (r) {
    case "good":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "ni":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "poor":
      return "bg-red-50 text-red-700 border-red-200";
    case "none":
      return "bg-stone-100 text-stone-400 border-stone-200";
  }
}

/** Format milliseconds: < 1000 → "850 ms", else "2.5 s". */
function ms(v: number | null): string {
  if (v == null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(v < 10000 ? 1 : 0)} s`;
}

function cls(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

/**
 * At-a-glance health strip for the dashboard home page. Server-rendered.
 * Summarizes the viewed day's articles into a row of metric cards so an
 * editor gets the headline numbers before scrolling into the detail.
 */
function scoreTone(v: number): string {
  return v >= 80
    ? "text-emerald-600"
    : v >= 60
      ? "text-amber-600"
      : "text-red-600";
}

export function DashboardKpis({
  analyzed,
  totalForDate,
  avgEditorial,
  avgSeo,
  needsAttention,
  errors,
  warnings,
}: {
  analyzed: number;
  totalForDate: number;
  avgEditorial: number;
  avgSeo: number;
  /** Articles with editorialScore < 80. */
  needsAttention: number;
  errors: number;
  warnings: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Kpi
        label="Articles"
        value={totalForDate.toLocaleString()}
        sub={`${analyzed.toLocaleString()} analyzed`}
      />
      <Kpi
        label="Avg editorial"
        value={`${avgEditorial}%`}
        valueClass={scoreTone(avgEditorial)}
        sub="target ≥ 80%"
      />
      <Kpi
        label="Avg SEO"
        value={`${avgSeo}%`}
        valueClass={scoreTone(avgSeo)}
        sub="target ≥ 80%"
      />
      <Kpi
        label="Need attention"
        value={needsAttention.toLocaleString()}
        valueClass={needsAttention > 0 ? "text-red-600" : "text-emerald-600"}
        sub="editorial < 80%"
        accent={needsAttention > 0 ? "red" : undefined}
      />
      <Kpi
        label="Errors"
        value={errors.toLocaleString()}
        valueClass={errors > 0 ? "text-red-600" : "text-emerald-600"}
        sub="across all rules"
      />
      <Kpi
        label="Warnings"
        value={warnings.toLocaleString()}
        valueClass={warnings > 0 ? "text-amber-600" : "text-emerald-600"}
        sub="across all rules"
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueClass = "text-foreground",
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
  accent?: "red";
}) {
  return (
    <div
      className={`rounded-xl border bg-card p-4 ${
        accent === "red" ? "border-red-200 bg-red-50/30" : ""
      }`}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
        {label}
      </div>
      <div
        className={`mt-1.5 text-2xl font-semibold tabular-nums leading-none ${valueClass}`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-muted">{sub}</div>
    </div>
  );
}

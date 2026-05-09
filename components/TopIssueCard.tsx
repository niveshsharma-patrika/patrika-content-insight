"use client";

import { Badge } from "./Badge";
import type { DashboardSummary } from "@/lib/types";

type Violation = DashboardSummary["topViolations"][number];

export function TopIssueCard({
  v,
  active,
  onSelect,
}: {
  v: Violation;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 flex items-start gap-3 transition ${
        active
          ? "border-accent bg-orange-50/60 ring-1 ring-orange-200"
          : "bg-card hover:border-stone-300"
      }`}
    >
      <div
        className={`mt-1 size-2.5 rounded-full shrink-0 ${
          v.severity === "error"
            ? "bg-red-500"
            : v.severity === "warning"
              ? "bg-amber-500"
              : "bg-sky-500"
        }`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-snug">{v.title}</div>
        <div className="text-xs text-muted mt-1 flex flex-wrap items-center gap-1.5">
          <span className="font-mono">{v.ruleId}</span>
          <Badge
            variant={
              v.severity === "error"
                ? "error"
                : v.severity === "warning"
                  ? "warning"
                  : "info"
            }
          >
            {v.severity}
          </Badge>
          <Badge variant={v.scope === "seo" ? "info" : "neutral"}>
            {v.scope}
          </Badge>
          <span className="capitalize">· {v.category}</span>
        </div>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
        <div className="text-xl font-semibold tabular-nums leading-none">
          {v.count}
        </div>
        <button
          type="button"
          onClick={onSelect}
          className={`text-[11px] font-medium px-2 py-1 rounded-md border transition whitespace-nowrap ${
            active
              ? "bg-accent text-accent-fg border-accent"
              : "border-stone-300 hover:border-foreground hover:bg-stone-50"
          }`}
        >
          {active ? "Filtering ✓" : "Show articles →"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Badge } from "./Badge";
import type { ArticleAnalysis, RuleScope } from "@/lib/types";

type RuleResultRow = ArticleAnalysis["results"][number];

const CATEGORY_ORDER = [
  "url",
  "headline",
  "meta",
  "intro",
  "body",
  "image",
  "embed",
  "seo",
  "schema",
  "eeat",
  "discover",
  "amp",
];

function groupByCategory(list: RuleResultRow[]): Record<string, RuleResultRow[]> {
  const out: Record<string, RuleResultRow[]> = {};
  for (const r of list) {
    out[r.rule.category] ??= [];
    out[r.rule.category].push(r);
  }
  return out;
}

type TabId = "editorial" | "seo";

export function RuleTabs({
  editorialResults,
  seoResults,
  editorialScore,
  seoScore,
}: {
  editorialResults: RuleResultRow[];
  seoResults: RuleResultRow[];
  editorialScore: number;
  seoScore: number;
}) {
  // Default the open tab to whichever has more failures (where the user's
  // attention is most likely needed).
  const editorialFails = editorialResults.filter((r) => !r.result.passed).length;
  const seoFails = seoResults.filter((r) => !r.result.passed).length;
  const [active, setActive] = useState<TabId>(
    editorialFails > seoFails ? "editorial" : seoFails > editorialFails ? "seo" : "editorial",
  );

  const editorialErrors = editorialResults.filter(
    (r) => !r.result.passed && r.rule.severity === "error",
  ).length;
  const seoErrors = seoResults.filter(
    (r) => !r.result.passed && r.rule.severity === "error",
  ).length;

  const tabs: Array<{
    id: TabId;
    label: string;
    score: number;
    fails: number;
    errors: number;
    total: number;
    scope: RuleScope;
  }> = [
    {
      id: "editorial",
      label: "Editorial",
      score: editorialScore,
      fails: editorialFails,
      errors: editorialErrors,
      total: editorialResults.length,
      scope: "editorial",
    },
    {
      id: "seo",
      label: "SEO",
      score: seoScore,
      fails: seoFails,
      errors: seoErrors,
      total: seoResults.length,
      scope: "seo",
    },
  ];

  const activeData =
    active === "editorial"
      ? {
          results: editorialResults,
          kicker: "Patrika.com editorial checklist",
          scope: "editorial" as RuleScope,
        }
      : {
          results: seoResults,
          kicker: "2026 Google best practices",
          scope: "seo" as RuleScope,
        };

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      {/* Tab bar */}
      <div role="tablist" className="flex border-b bg-stone-50">
        {tabs.map((t) => {
          const isActive = active === t.id;
          const tone =
            t.score >= 80
              ? "text-emerald-700"
              : t.score >= 60
                ? "text-amber-700"
                : "text-red-700";
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={`flex-1 px-5 py-3 text-left transition border-b-2 ${
                isActive
                  ? t.scope === "seo"
                    ? "bg-card border-sky-500"
                    : "bg-card border-amber-500"
                  : "border-transparent hover:bg-stone-100 text-muted"
              }`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div
                    className={`text-[11px] uppercase tracking-wide font-medium ${
                      isActive ? "text-muted" : "text-muted"
                    }`}
                  >
                    {t.scope === "seo"
                      ? "2026 Google best practices"
                      : "Patrika.com checklist"}
                  </div>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span
                      className={`text-lg font-semibold ${
                        isActive ? "text-foreground" : "text-muted"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span
                      className={`text-2xl font-semibold tabular-nums ${
                        isActive ? tone : "text-muted"
                      }`}
                    >
                      {t.score}%
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end text-xs gap-1">
                  <span className="text-muted">
                    {t.total - t.fails}/{t.total} pass
                  </span>
                  <div className="flex gap-1">
                    {t.errors > 0 ? (
                      <Badge variant="error">{t.errors}E</Badge>
                    ) : null}
                    {t.fails - t.errors > 0 ? (
                      <Badge variant="warning">{t.fails - t.errors}W</Badge>
                    ) : null}
                    {t.fails === 0 ? (
                      <Badge variant="pass">clean</Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      <RuleList
        results={activeData.results}
        kicker={activeData.kicker}
        scope={activeData.scope}
      />
    </section>
  );
}

function RuleList({
  results,
  scope,
}: {
  results: RuleResultRow[];
  kicker: string;
  scope: RuleScope;
}) {
  const grouped = groupByCategory(results);
  const categories = CATEGORY_ORDER.filter((c) => grouped[c]?.length);

  if (results.length === 0) {
    return (
      <div className="p-5 text-sm text-muted">
        No rules in this section.
      </div>
    );
  }

  return (
    <div>
      {categories.map((cat) => (
        <div key={`${scope}-${cat}`} className="border-b last:border-0">
          <div className="px-5 py-2 bg-stone-50/60 text-xs uppercase tracking-wide text-muted flex justify-between items-center">
            <span>{cat}</span>
            <span className="text-[10px]">
              {grouped[cat].length} check{grouped[cat].length === 1 ? "" : "s"}
            </span>
          </div>
          <ul>
            {grouped[cat].map((r) => (
              <RuleRow key={r.rule.id} r={r} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RuleRow({ r }: { r: RuleResultRow }) {
  const sev = r.rule.severity;
  const passed = r.result.passed;
  return (
    <li
      className={`px-5 py-3 border-t flex items-start gap-3 ${
        passed
          ? ""
          : sev === "error"
            ? "bg-red-50/30"
            : sev === "warning"
              ? "bg-amber-50/30"
              : ""
      }`}
    >
      <span
        className={`mt-1.5 size-2 rounded-full shrink-0 ${
          passed
            ? "bg-emerald-500"
            : sev === "error"
              ? "bg-red-500"
              : sev === "warning"
                ? "bg-amber-500"
                : "bg-sky-500"
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{r.rule.title}</span>
          <Badge
            variant={
              passed
                ? "pass"
                : sev === "error"
                  ? "error"
                  : sev === "warning"
                    ? "warning"
                    : "info"
            }
          >
            {passed ? "pass" : sev}
          </Badge>
          <span className="text-xs font-mono text-muted">{r.rule.id}</span>
        </div>

        {!passed && r.result.message ? (
          <p
            className={`mt-1.5 text-sm font-medium ${
              sev === "error"
                ? "text-red-700"
                : sev === "warning"
                  ? "text-amber-800"
                  : "text-sky-800"
            }`}
          >
            ⚠ {r.result.message}
          </p>
        ) : null}
        {r.result.detail ? (
          <pre className="mt-1 text-[11px] font-mono text-stone-700 break-all whitespace-pre-wrap bg-stone-50 rounded-md p-2 border border-stone-200">
            {r.result.detail}
          </pre>
        ) : null}

        <p className="mt-1.5 text-xs text-muted leading-snug">
          <span className="uppercase tracking-wide text-[10px] text-muted">
            Why:
          </span>{" "}
          {r.rule.description}
        </p>
        {r.rule.reference ? (
          <p className="mt-1 text-[11px] text-muted italic">
            {r.rule.reference}
          </p>
        ) : null}
      </div>
    </li>
  );
}

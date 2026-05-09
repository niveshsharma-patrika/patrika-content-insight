"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { ArticleCard } from "./ArticleCard";
import { TopIssueCard } from "./TopIssueCard";
import {
  DEFAULT_FILTERS,
  FilterBar,
  type FilterState,
  type SectionOption,
  type UserOption,
} from "./FilterBar";
import type { ArticleAnalysis, DashboardSummary } from "@/lib/types";
import type { SlugVerdict } from "@/lib/gemini";
import type { User } from "@/lib/users";
import { categoryFromUrl } from "@/lib/utils";

export function ComplianceSection({
  summary,
  pageArticles,
  allCategories,
  allUsers = [],
  slugVerdicts = {},
  userMap = {},
  editorCount = 0,
  hour,
  countsPerHour,
  totalForDate,
}: {
  /** Aggregate stats — used for Top Issues, By Category, KPIs. */
  summary: DashboardSummary;
  /** Articles published in the chosen IST hour. */
  pageArticles: ArticleAnalysis[];
  allCategories: SectionOption[];
  /** Active authors — used to populate the Authors filter. */
  allUsers?: UserOption[];
  editorCount?: number;
  slugVerdicts?: Record<string, SlugVerdict>;
  userMap?: Record<string, User | null>;
  /** 0–23 IST hour currently being viewed. */
  hour: number;
  /** Per-hour article counts for the date (length 24, index = hour). */
  countsPerHour: number[];
  /** Total articles for the day (across all hours). */
  totalForDate: number;
}) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [ruleFilter, setRuleFilter] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const articlesAnchorRef = useRef<HTMLDivElement | null>(null);

  function selectRule(id: string, title: string) {
    if (ruleFilter?.id === id) {
      setRuleFilter(null);
      return;
    }
    setRuleFilter({ id, title });
    setFilters({ ...filters, status: "all" });
  }

  useEffect(() => {
    if (!ruleFilter) return;
    articlesAnchorRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [ruleFilter]);

  // ---- Filter pipeline (scope-aware) ----
  const filtered = useMemo(() => {
    let list = pageArticles.filter((a) => {
      // Section
      if (
        filters.sections.length > 0 &&
        !filters.sections.includes(categoryFromUrl(a.sitemap.url))
      )
        return false;

      // Authors — match against the userMap so unknown bylines never
      // pass when an author filter is active.
      if (filters.users.length > 0) {
        const matched = userMap[a.sitemap.url];
        if (!matched) return false;
        if (!filters.users.includes(matched.id)) return false;
      }

      // Compute scope-specific failure counts so status filter is correct.
      const inScope = (scope: "editorial" | "seo") => (r: typeof a.results[number]) =>
        r.rule.scope === scope;
      const matchScope =
        filters.scope === "all"
          ? () => true
          : inScope(filters.scope);
      const fails = a.results.filter(matchScope).filter((r) => !r.result.passed);
      const scopeErrors = fails.filter((r) => r.rule.severity === "error").length;
      const scopeWarnings = fails.filter((r) => r.rule.severity === "warning").length;

      if (filters.status === "errors" && scopeErrors === 0) return false;
      if (
        filters.status === "warnings" &&
        !(scopeErrors === 0 && scopeWarnings > 0)
      )
        return false;
      if (
        filters.status === "clean" &&
        !(a.article.ok && scopeErrors === 0 && scopeWarnings === 0)
      )
        return false;
      if (filters.status === "fetch_failed" && a.article.ok) return false;

      // Rule filter (set from clicking a top-issue card)
      if (ruleFilter) {
        const failing = a.results.some(
          (r) => r.rule.id === ruleFilter.id && !r.result.passed,
        );
        if (!failing) return false;
      }
      return true;
    });

    // Sort — use scope-specific score when scope is set.
    const scoreFor = (a: ArticleAnalysis) =>
      filters.scope === "editorial"
        ? a.editorialScore
        : filters.scope === "seo"
          ? a.seoScore
          : a.score;

    if (filters.sort === "score-asc")
      list = [...list].sort((a, b) => scoreFor(a) - scoreFor(b));
    else if (filters.sort === "score-desc")
      list = [...list].sort((a, b) => scoreFor(b) - scoreFor(a));
    else if (filters.sort === "recent")
      list = [...list].sort((a, b) =>
        a.sitemap.publishedAt < b.sitemap.publishedAt ? 1 : -1,
      );
    else if (filters.sort === "issues-desc")
      list = [...list].sort((a, b) => {
        const ai = a.results.filter((r) => !r.result.passed).length;
        const bi = b.results.filter((r) => !r.result.passed).length;
        return bi - ai;
      });
    return list;
  }, [pageArticles, filters, ruleFilter]);

  // Top issues filtered by scope so the panel matches the active scope filter
  const topViolations = useMemo(() => {
    if (filters.scope === "all") return summary.topViolations;
    return summary.topViolations.filter((v) => v.scope === filters.scope);
  }, [summary.topViolations, filters.scope]);

  return (
    <div className="space-y-6">
      {/* === ISSUES PANEL === */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Top issues across analyzed articles
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {summary.analyzed.toLocaleString()} of{" "}
              {totalForDate.toLocaleString()} articles for the day · click
              an issue to filter the list below.
            </p>
          </div>
          <a
            href="/rules"
            className="text-sm text-muted hover:text-foreground"
          >
            Rule catalog →
          </a>
        </div>

        {topViolations.length === 0 ? (
          <div className="rounded-xl border bg-card p-6 text-sm text-muted text-center">
            {summary.analyzed === 0
              ? "No articles analyzed yet — open any page to start."
              : "No violations match the current scope filter."}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2.5">
            {topViolations.map((v) => (
              <TopIssueCard
                key={v.ruleId}
                v={v}
                active={ruleFilter?.id === v.ruleId}
                onSelect={() => selectRule(v.ruleId, v.title)}
              />
            ))}
          </div>
        )}
      </section>

      {/* === ARTICLE CARDS === */}
      <section
        ref={articlesAnchorRef}
        id="articles-anchor"
        className="space-y-3"
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Articles · {formatHourRange(hour)}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Showing {pageArticles.length} article
              {pageArticles.length === 1 ? "" : "s"} published in this
              hour · {totalForDate.toLocaleString()} total for the day
            </p>
          </div>
        </div>

        <HourStrip activeHour={hour} countsPerHour={countsPerHour} />

        <FilterBar
          state={filters}
          setState={setFilters}
          totalOnPage={pageArticles.length}
          allCategories={allCategories}
          allUsers={allUsers}
          resultCount={filtered.length}
        />

        {ruleFilter ? (
          <div className="flex items-center justify-between gap-3 rounded-md bg-orange-50 ring-1 ring-orange-200 px-3 py-2 text-sm">
            <div className="min-w-0">
              <span className="text-orange-900 font-semibold">
                Showing only articles failing:
              </span>{" "}
              <span className="text-orange-800">{ruleFilter.title}</span>{" "}
              <span className="text-xs font-mono text-orange-700">
                ({ruleFilter.id})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRuleFilter(null)}
              className="rounded-md border border-orange-300 bg-white text-orange-800 px-2 py-0.5 text-xs hover:bg-orange-100 whitespace-nowrap"
            >
              Clear ✕
            </button>
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted">
            {ruleFilter ? (
              "No articles in this hour fail this rule. Try another hour."
            ) : pageArticles.length === 0 ? (
              <>
                Nothing was published in{" "}
                <span className="font-medium text-foreground">
                  {formatHourRange(hour)}
                </span>{" "}
                IST. Pick a different hour above.
              </>
            ) : (
              "No articles in this hour match these filters."
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((a) => (
              <ArticleCard
                key={a.sitemap.url}
                a={a}
                ruleFilterId={ruleFilter?.id ?? null}
                slugVerdict={slugVerdicts[a.sitemap.url]}
                matchedUser={userMap[a.sitemap.url] ?? null}
                editorCount={editorCount}
              />
            ))}
          </div>
        )}

      </section>
    </div>
  );
}

/* ---------------- Hour pagination ---------------- */

function formatHourRange(hour: number): string {
  return `${formatIstHour(hour)} – ${formatIstHour((hour + 1) % 24)}`;
}

function formatIstHour(hour: number): string {
  if (hour === 0) return "12:00 AM";
  if (hour === 12) return "12:00 PM";
  return hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
}

function shortHourLabel(hour: number): string {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
  return hour < 12 ? `${hour}am` : `${hour - 12}pm`;
}

function HourStrip({
  activeHour,
  countsPerHour,
}: {
  activeHour: number;
  countsPerHour: number[];
}) {
  // useTransition so the user sees feedback while the next hour's
  // server render is in flight. Same approach as the old page-based
  // Pagination but applied per-hour-button.
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [pendingHour, setPendingHour] = useState<number | null>(null);

  function go(h: number) {
    setPendingHour(h);
    const merged = new URLSearchParams(params?.toString() ?? "");
    merged.set("hour", String(h));
    startTransition(() => {
      router.push(`/?${merged.toString()}`, { scroll: false });
      setTimeout(() => {
        document
          .getElementById("articles-anchor")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    });
  }

  return (
    <nav
      aria-label="Pick an hour"
      className={`grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-12 gap-1.5 ${
        pending ? "opacity-70" : ""
      }`}
      aria-busy={pending}
    >
      {Array.from({ length: 24 }, (_, h) => {
        const count = countsPerHour[h] ?? 0;
        const isActive = h === activeHour;
        const isPending = pending && pendingHour === h;
        const isEmpty = count === 0;
        // Empty-hour buttons can't show anything useful — disable
        // them so editors don't click into a known-blank view. The
        // active button stays clickable so users can still see they
        // are on it.
        const disabled = pending || (isEmpty && !isActive);
        return (
          <button
            key={h}
            type="button"
            disabled={disabled}
            aria-current={isActive ? "page" : undefined}
            onClick={() => go(h)}
            className={
              isActive
                ? "rounded-md bg-foreground text-background px-2 py-1.5 text-xs font-medium tabular-nums"
                : isPending
                  ? "rounded-md border bg-stone-100 text-muted px-2 py-1.5 text-xs tabular-nums"
                  : isEmpty
                    ? "rounded-md border bg-card text-muted-foreground/60 px-2 py-1.5 text-xs tabular-nums hover:bg-stone-50"
                    : "rounded-md border bg-card hover:bg-stone-50 px-2 py-1.5 text-xs text-foreground tabular-nums"
            }
            title={`${formatHourRange(h)} · ${count} article${count === 1 ? "" : "s"}`}
          >
            <span className="block leading-none">{shortHourLabel(h)}</span>
            <span
              className={`block text-[10px] mt-0.5 leading-none ${
                isActive
                  ? "opacity-80"
                  : isEmpty
                    ? "text-muted-foreground/60"
                    : "text-muted"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}


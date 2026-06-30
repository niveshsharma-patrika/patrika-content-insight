"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArticleCard } from "./ArticleCard";
import { TopIssueCard } from "./TopIssueCard";
import {
  DEFAULT_FILTERS,
  FilterBar,
  type FilterState,
  type SectionOption,
  type UserOption,
} from "./FilterBar";
import type { ArticleLite, DashboardSummary } from "@/lib/types";

/** Hour selection: a specific IST hour 0–23, or "all" hours of the day. */
type HourSel = number | "all";

export function ComplianceSection({
  summary,
  articles,
  allCategories,
  allUsers = [],
  editorCount = 0,
  countsPerHour,
  totalForDate,
  isToday = true,
  dateLabel,
}: {
  /** Aggregate stats — used for Top Issues, By Category, KPIs. */
  summary: DashboardSummary;
  /** The WHOLE day's articles, compact. Hour-switching + filtering all
   *  happen client-side over this list — no server round-trip. */
  articles: ArticleLite[];
  allCategories: SectionOption[];
  /** Active authors — used to populate the Authors filter. */
  allUsers?: UserOption[];
  editorCount?: number;
  /** Per-hour article counts for the date (length 24, index = hour). */
  countsPerHour: number[];
  /** Total articles for the day (across all hours). */
  totalForDate: number;
  /** Whether the viewed date is today (controls the "Today" button). */
  isToday?: boolean;
  /** Short label for the viewed date, e.g. "Jun 30" — used in messages. */
  dateLabel?: string;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  // Default view = ALL of the day's articles (not a single hour), so the
  // dashboard lands showing everything. Hour buttons narrow from there.
  const [hourSel, setHourSel] = useState<HourSel>("all");
  const [ruleFilter, setRuleFilter] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const articlesAnchorRef = useRef<HTMLDivElement | null>(null);

  // "Today" reset: clear all filters, show all hours, and jump to today's
  // date if we're viewing an archive day.
  function goToday() {
    setFilters(DEFAULT_FILTERS);
    setRuleFilter(null);
    setHourSel("all");
    if (!isToday) router.push("/");
  }

  // When the user narrows by author or section, the result almost
  // certainly spans multiple hours — so widen the hour selection to
  // "all" automatically. This is the fix for the old bug where picking
  // an author who didn't publish in the current hour showed nothing.
  function updateFilters(next: FilterState) {
    const narrowed =
      (next.users.length > 0 && filters.users.length === 0) ||
      (next.sections.length > 0 && filters.sections.length === 0);
    if (narrowed) setHourSel("all");
    setFilters(next);
  }

  function selectRule(id: string, title: string) {
    if (ruleFilter?.id === id) {
      setRuleFilter(null);
      return;
    }
    // A rule can fire in any hour — show matches across the whole day.
    setHourSel("all");
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

  // ---- Filter pipeline (whole-day, scope-aware) ----
  const filtered = useMemo(() => {
    let list = articles.filter((a) => {
      // Hour (skipped when viewing "all")
      if (hourSel !== "all" && a.hour !== hourSel) return false;

      // Section
      if (filters.sections.length > 0 && !filters.sections.includes(a.category))
        return false;

      // Authors — match against the resolved app_users id so unknown
      // bylines never pass when an author filter is active.
      if (filters.users.length > 0) {
        if (!a.matchedUser) return false;
        if (!filters.users.includes(a.matchedUser.id)) return false;
      }

      // Scope-specific failure counts so the status filter is correct.
      const scopeFails =
        filters.scope === "all"
          ? a.fails
          : a.fails.filter((f) => f.scope === filters.scope);
      const scopeErrors = scopeFails.filter((f) => f.severity === "error").length;
      const scopeWarnings = scopeFails.filter(
        (f) => f.severity === "warning",
      ).length;

      if (filters.status === "errors" && scopeErrors === 0) return false;
      if (
        filters.status === "warnings" &&
        !(scopeErrors === 0 && scopeWarnings > 0)
      )
        return false;
      if (
        filters.status === "clean" &&
        !(a.ok && scopeErrors === 0 && scopeWarnings === 0)
      )
        return false;
      if (filters.status === "fetch_failed" && a.ok) return false;

      // Rule filter (set from clicking a top-issue card)
      if (ruleFilter && !a.fails.some((f) => f.ruleId === ruleFilter.id))
        return false;

      return true;
    });

    // Sort — use scope-specific score when scope is set.
    const scoreFor = (a: ArticleLite) =>
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
        a.publishedAt < b.publishedAt ? 1 : -1,
      );
    else if (filters.sort === "issues-desc")
      list = [...list].sort((a, b) => b.fails.length - a.fails.length);
    return list;
  }, [articles, filters, ruleFilter, hourSel]);

  // Count for the current hour selection (before author/section/status
  // filters) — drives the sub-header.
  const inHourCount =
    hourSel === "all"
      ? totalForDate
      : countsPerHour[hourSel] ?? 0;

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
          <a href="/rules" className="text-sm text-muted hover:text-foreground">
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
      <section ref={articlesAnchorRef} id="articles-anchor" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Articles ·{" "}
              {hourSel === "all" ? "All hours" : formatHourRange(hourSel)}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {hourSel === "all" ? (
                <>
                  Showing {filtered.length.toLocaleString()} of{" "}
                  {totalForDate.toLocaleString()} articles for the day
                </>
              ) : (
                <>
                  {inHourCount} article{inHourCount === 1 ? "" : "s"} published in
                  this hour · {totalForDate.toLocaleString()} total for the day
                </>
              )}
            </p>
          </div>
          {/* Reset to today + all articles (clears hour/filter/date). */}
          <button
            type="button"
            onClick={goToday}
            className="self-center rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:bg-stone-800 whitespace-nowrap"
            title="Show all of today's articles"
          >
            Today · all articles
          </button>
        </div>

        <HourStrip
          hourSel={hourSel}
          countsPerHour={countsPerHour}
          totalForDate={totalForDate}
          onPick={(h) => {
            setHourSel(h);
            articlesAnchorRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          }}
        />

        <FilterBar
          state={filters}
          setState={updateFilters}
          totalOnPage={hourSel === "all" ? totalForDate : inHourCount}
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
              "No articles fail this rule today. Clear the rule filter to see all."
            ) : totalForDate === 0 ? (
              "Nothing scraped for this day yet."
            ) : filters.users.length > 0 ? (
              <>
                No articles from{" "}
                <span className="font-medium text-foreground">
                  {filters.users
                    .map((id) => allUsers.find((u) => u.id === id)?.label ?? id)
                    .join(", ")}
                </span>{" "}
                on {dateLabel ?? (isToday ? "today" : "this day")}. Try another
                date, or clear the author filter.
              </>
            ) : (
              "No articles match these filters. Try widening them or switching to All hours."
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((a) => (
              <ArticleCard
                key={a.url}
                a={a}
                ruleFilterId={ruleFilter?.id ?? null}
                editorCount={editorCount}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------- Hour selection ---------------- */

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
  hourSel,
  countsPerHour,
  totalForDate,
  onPick,
}: {
  hourSel: HourSel;
  countsPerHour: number[];
  totalForDate: number;
  onPick: (h: HourSel) => void;
}) {
  // Pure client-side hour switching — instant, no server round-trip.
  return (
    <nav
      aria-label="Pick an hour"
      className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-12 gap-1.5"
    >
      <button
        type="button"
        aria-current={hourSel === "all" ? "page" : undefined}
        onClick={() => onPick("all")}
        className={
          hourSel === "all"
            ? "rounded-md bg-foreground text-background px-2 py-1.5 text-xs font-medium tabular-nums"
            : "rounded-md border bg-card hover:bg-stone-50 px-2 py-1.5 text-xs text-foreground tabular-nums"
        }
        title={`All hours · ${totalForDate} article${totalForDate === 1 ? "" : "s"}`}
      >
        <span className="block leading-none">All</span>
        <span
          className={`block text-[10px] mt-0.5 leading-none ${
            hourSel === "all" ? "opacity-80" : "text-muted"
          }`}
        >
          {totalForDate}
        </span>
      </button>
      {Array.from({ length: 24 }, (_, h) => {
        const count = countsPerHour[h] ?? 0;
        const isActive = h === hourSel;
        const isEmpty = count === 0;
        const disabled = isEmpty && !isActive;
        return (
          <button
            key={h}
            type="button"
            disabled={disabled}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onPick(h)}
            className={
              isActive
                ? "rounded-md bg-foreground text-background px-2 py-1.5 text-xs font-medium tabular-nums"
                : isEmpty
                  ? "rounded-md border bg-card text-muted-foreground/60 px-2 py-1.5 text-xs tabular-nums"
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

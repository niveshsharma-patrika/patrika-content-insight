"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArticleCard } from "./ArticleCard";
import { TopIssueCard } from "./TopIssueCard";
import {
  DEFAULT_FILTERS,
  FilterBar,
  type FilterState,
} from "./FilterBar";
import type { ArticleAnalysis, DashboardSummary } from "@/lib/types";
import type { SlugVerdict } from "@/lib/gemini";
import type { User } from "@/lib/users";
import { categoryFromUrl } from "@/lib/utils";

export function ComplianceSection({
  summary,
  pageArticles,
  allCategories,
  slugVerdicts = {},
  userMap = {},
  page,
  pageCount,
  totalEntries,
  cachedCount,
}: {
  /** Aggregate stats — used for Top Issues, By Category, KPIs. */
  summary: DashboardSummary;
  /** Just the visible page (24 articles by default). */
  pageArticles: ArticleAnalysis[];
  allCategories: string[];
  slugVerdicts?: Record<string, SlugVerdict>;
  userMap?: Record<string, User | null>;
  page: number;
  pageCount: number;
  totalEntries: number;
  cachedCount: number;
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
              {totalEntries.toLocaleString()} articles in the cache · click an
              issue to filter the list below.
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
      <section ref={articlesAnchorRef} className="space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Articles · page {page} of {pageCount}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              Showing {pageArticles.length} of{" "}
              {totalEntries.toLocaleString()} · {cachedCount.toLocaleString()}{" "}
              scraped on disk
            </p>
          </div>
        </div>

        <FilterBar
          state={filters}
          setState={setFilters}
          totalOnPage={pageArticles.length}
          allCategories={allCategories}
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
            {ruleFilter
              ? "No articles on this page fail this rule. Try another page."
              : "No articles on this page match these filters."}
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
              />
            ))}
          </div>
        )}

        <Pagination page={page} pageCount={pageCount} />
      </section>
    </div>
  );
}

// ---------- Pagination ----------

function Pagination({
  page,
  pageCount,
}: {
  page: number;
  pageCount: number;
}) {
  if (pageCount <= 1) return null;

  // Build a compact page list: first, last, current ±2, ellipses elsewhere.
  const items: Array<number | "ellipsis"> = [];
  const window = 2;
  const include = new Set<number>([1, pageCount]);
  for (let i = page - window; i <= page + window; i++) {
    if (i >= 1 && i <= pageCount) include.add(i);
  }
  let prev = 0;
  for (const i of [...include].sort((a, b) => a - b)) {
    if (prev && i - prev > 1) items.push("ellipsis");
    items.push(i);
    prev = i;
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-1 pt-2 flex-wrap"
    >
      <PageLink page={page - 1} disabled={page <= 1} label="‹ Prev" />
      {items.map((it, i) =>
        it === "ellipsis" ? (
          <span key={`e-${i}`} className="px-1.5 text-muted">
            …
          </span>
        ) : (
          <PageLink
            key={it}
            page={it}
            label={String(it)}
            active={it === page}
          />
        ),
      )}
      <PageLink page={page + 1} disabled={page >= pageCount} label="Next ›" />
    </nav>
  );
}

function PageLink({
  page,
  label,
  active = false,
  disabled = false,
}: {
  page: number;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  // Preserve all current query params (notably `date`) when navigating
  // pages. Otherwise switching pages would silently drop the chosen
  // date and bounce the user back to "today".
  const params = useSearchParams();
  const merged = new URLSearchParams(params?.toString() ?? "");
  merged.set("page", String(page));
  const href = `/?${merged.toString()}`;

  if (disabled) {
    return (
      <span className="px-2.5 py-1 text-sm text-muted-foreground select-none">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`px-2.5 py-1 rounded-md text-sm tabular-nums transition ${
        active
          ? "bg-foreground text-background"
          : "border bg-card hover:bg-stone-50"
      }`}
    >
      {label}
    </Link>
  );
}

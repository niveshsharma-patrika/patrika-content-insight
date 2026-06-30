import { getDayDashboard } from "@/lib/analyze";
import { ComplianceSection } from "@/components/ComplianceSection";
import { CoreWebVitals } from "@/components/CoreWebVitals";
import { DailyIssuesChart } from "@/components/DailyIssuesChart";
import { DashboardKpis } from "@/components/DashboardKpis";
import { DatePicker } from "@/components/DatePicker";
import { readLatestCwvReports } from "@/lib/cwv";
import { readRecentSnapshots } from "@/lib/dashboardStats";
import { formatRelative } from "@/lib/utils";
import { listUsers } from "@/lib/users";
import { listEditors } from "@/lib/editors";
import { listSections } from "@/lib/sections";
import { clampDateToWindow, dayHeaderLabel, todayInIST } from "@/lib/dates";

// No caching. Every page load re-queries Supabase so editors always
// see the latest cron-tick state without any staleness window.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RETENTION_DAYS = 7;

type SearchParams = Promise<{
  date?: string;
}>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  // Clamp to retention window — bookmarked or hand-typed out-of-range
  // dates fall back to today.
  const istDate = clampDateToWindow(sp.date, RETENTION_DAYS);
  const isToday = istDate === todayInIST();

  // ONE whole-day read + analysis. Hour-switching and all filtering now
  // happen client-side over the returned compact list — no per-click
  // server round-trip (this is the speed + author-filter fix).
  const [
    dashboard,
    sectionRows,
    allActiveUsers,
    allEditors,
    cwvReports,
    recentSnapshots,
  ] = await Promise.all([
    // getDayDashboard already degrades to an empty dashboard on DB error.
    // Make the side reads fail-soft too so a DB outage never crashes the
    // page — it renders the empty state instead.
    getDayDashboard({ date: istDate }),
    listSections({ activeOnly: true }).catch(() => []),
    listUsers().catch(() => []),
    listEditors({ activeOnly: true }).catch(() => []),
    readLatestCwvReports().catch(() => []),
    readRecentSnapshots(RETENTION_DAYS).catch(() => []),
  ]);
  const summary = dashboard.summary;
  const allCategories = sectionRows.map((s) => ({
    id: s.id,
    label: s.displayName,
  }));
  // Authors filter — only active users, surfaced as { id, label }.
  const allAuthorOptions = allActiveUsers
    .filter((u) => u.active)
    .map((u) => ({ id: u.id, label: u.name }));

  const editorCount = allEditors.filter((e) => e.telegramChatId).length;

  const sitemapTotal = dashboard.sitemapTotalForDate;
  const lastTickRel = dashboard.lastCronTickAt
    ? formatRelative(dashboard.lastCronTickAt)
    : null;
  // Articles still below the editorial bar — the "needs attention" count.
  const needsAttention = dashboard.articles.filter(
    (a) => a.ok && a.editorialScore < 80,
  ).length;

  return (
    <div className="mx-auto max-w-7xl px-6 py-7 space-y-6">
      {/* === HEADER === */}
      <header className="rounded-2xl border bg-card px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-muted font-medium">
              Editorial QA · patrika.com
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight flex items-center gap-2 flex-wrap">
              {dayHeaderLabel(istDate)}
              {!isToday ? (
                <span className="rounded-full bg-stone-100 text-stone-600 px-2 py-0.5 text-[11px] font-medium">
                  archive
                </span>
              ) : null}
            </h1>
          </div>

          {/* Status pills (scrape freshness, fetch failures) */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-stone-50 px-2.5 py-1">
              <span className="font-mono tabular-nums font-medium text-foreground">
                {dashboard.totalForDate.toLocaleString()}
              </span>
              {sitemapTotal > dashboard.totalForDate ? (
                <span className="text-muted">
                  / {sitemapTotal.toLocaleString()}
                </span>
              ) : null}
              <span className="text-muted">scraped{isToday ? " today" : ""}</span>
            </span>
            {isToday ? (
              lastTickRel ? (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border bg-stone-50 px-2.5 py-1 text-muted"
                  suppressHydrationWarning
                >
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  cron {lastTickRel}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-700">
                  <span className="size-1.5 rounded-full bg-amber-500" />
                  no cron tick yet
                </span>
              )
            ) : null}
            {dashboard.failedToFetch > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                {dashboard.failedToFetch} fetch failed
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 border-t pt-4">
          <DatePicker activeDate={istDate} />
        </div>
      </header>

      {/* === KPI STRIP (today's health at a glance) === */}
      {dashboard.totalForDate > 0 ? (
        <DashboardKpis
          analyzed={summary.analyzed}
          totalForDate={dashboard.totalForDate}
          avgEditorial={summary.averageEditorialScore}
          avgSeo={summary.averageSeoScore}
          needsAttention={needsAttention}
          errors={summary.errors}
          warnings={summary.warnings}
        />
      ) : null}

      {/* === TRENDS (full width — heights differ too much to pair) === */}
      <DailyIssuesChart snapshots={recentSnapshots} />
      <CoreWebVitals reports={cwvReports} />

      {/* === ISSUES + ARTICLES === */}
      {dashboard.totalForDate === 0 ? (
        <div className="rounded-2xl border bg-card p-12 text-center space-y-3">
          <p className="text-sm font-medium">
            {isToday
              ? "Nothing scraped yet for today."
              : `No articles archived for ${dayHeaderLabel(istDate)}.`}
          </p>
          <p className="text-sm text-muted max-w-md mx-auto">
            {isToday ? (
              <>
                The hourly cron is the only thing that fetches new
                articles and updates this page. It runs on the hour,
                every hour, in production. Until it ticks, this view
                stays empty.
              </>
            ) : (
              <>
                Either the cron wasn&apos;t running on that day, or the
                articles have already been purged (we keep the last{" "}
                {RETENTION_DAYS} days).
              </>
            )}
          </p>
          {isToday && sitemapTotal > 0 ? (
            <p className="text-xs text-muted">
              {sitemapTotal.toLocaleString()} articles in the most recent
              snapshot.
            </p>
          ) : null}
        </div>
      ) : (
        <ComplianceSection
          summary={summary}
          articles={dashboard.articles}
          allCategories={allCategories}
          allUsers={allAuthorOptions}
          editorCount={editorCount}
          countsPerHour={dashboard.countsPerHour}
          totalForDate={dashboard.totalForDate}
          isToday={isToday}
          dateLabel={isToday ? undefined : dayHeaderLabel(istDate)}
        />
      )}
    </div>
  );
}

import {
  getCachedDashboardStats,
  getPaginatedDashboard,
} from "@/lib/analyze";
import { ComplianceSection } from "@/components/ComplianceSection";
import { DatePicker } from "@/components/DatePicker";
import { formatRelative } from "@/lib/utils";
import { readCachedSlugVerdicts } from "@/lib/gemini";
import { findUsersForBylines, type User } from "@/lib/users";
import { listEditors } from "@/lib/editors";
import { listSections } from "@/lib/sections";
import { clampDateToWindow, dayHeaderLabel, todayInIST } from "@/lib/dates";

// Cache rendered output for 30s per URL (i.e. per ?date= / ?page= combo).
// The cron only writes hourly so 30s of staleness is negligible, and
// repeat visits within a session render in <50ms instead of re-running
// every Supabase query.
export const revalidate = 30;

const PER_PAGE = 24;
const RETENTION_DAYS = 7;

type SearchParams = Promise<{
  page?: string;
  date?: string;
}>;

export default async function Page({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  // Clamp to retention window — bookmarked or hand-typed out-of-range
  // dates fall back to today.
  const istDate = clampDateToWindow(sp.date, RETENTION_DAYS);
  const isToday = istDate === todayInIST();

  // Pure DB read. The cron is the only thing that touches the live
  // sitemap; the dashboard reads articles + the daily snapshot row.
  const dashboard = await getPaginatedDashboard({
    page,
    perPage: PER_PAGE,
    date: istDate,
  });

  // Aggregate stats across all of the chosen day's stored articles, for
  // the Top Issues panel. Same DB-only data source.
  const cachedStats = await getCachedDashboardStats({ date: istDate });
  const summary = cachedStats ?? dashboard.summary;

  const slugVerdicts = await readCachedSlugVerdicts(
    dashboard.summary.articles.map((a) => a.sitemap.url),
  );
  const matchedUsers = await findUsersForBylines(
    dashboard.summary.articles.map((a) => a.article.author),
  );
  const userMap: Record<string, User | null> = {};
  dashboard.summary.articles.forEach((a, i) => {
    userMap[a.sitemap.url] = matchedUsers[i];
  });

  // Sections come from the DB now — auto-imported by the cron, edited
  // in Settings. The dashboard shows every active section, not only
  // those that happened to land on the visible page.
  const sectionRows = await listSections({ activeOnly: true });
  const allCategories = sectionRows.map((s) => ({
    id: s.id,
    label: s.displayName,
  }));

  // Count active editors with chat IDs — drives the Notify button's
  // "always actionable" behavior on cards even when an article's
  // author has no chat ID.
  const editorCount = (await listEditors({ activeOnly: true })).filter(
    (e) => e.telegramChatId,
  ).length;

  const sitemapTotal = dashboard.totalEntries;
  const lastTickRel = dashboard.lastCronTickAt
    ? formatRelative(dashboard.lastCronTickAt)
    : null;

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {dayHeaderLabel(istDate)}
            {!isToday ? (
              <span className="ml-2 text-xs font-normal text-muted">
                (archive)
              </span>
            ) : null}
          </h1>
          <DatePicker activeDate={istDate} />
          <p className="text-sm text-muted">
            <span className="font-mono tabular-nums">
              {dashboard.cachedCount.toLocaleString()}
            </span>
            {sitemapTotal > dashboard.cachedCount ? (
              <>
                {" "}
                of{" "}
                <span className="font-mono tabular-nums">
                  {sitemapTotal.toLocaleString()}
                </span>
              </>
            ) : null}{" "}
            articles scraped
            {isToday ? " today" : ""}
            {isToday ? (
              <>
                {" · "}
                {lastTickRel ? (
                  <span suppressHydrationWarning>
                    last cron tick {lastTickRel}
                  </span>
                ) : (
                  <span className="text-amber-700">no cron tick yet</span>
                )}
              </>
            ) : null}
            {dashboard.failedToFetch > 0 ? (
              <>
                {" · "}
                <span className="text-red-700">
                  {dashboard.failedToFetch} fetch failed
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {/* === ISSUES + ARTICLES === */}
      {dashboard.cachedCount === 0 ? (
        <div className="rounded-xl border bg-card p-12 text-center space-y-3">
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
          pageArticles={dashboard.summary.articles}
          allCategories={allCategories}
          slugVerdicts={slugVerdicts}
          userMap={userMap}
          editorCount={editorCount}
          page={dashboard.page}
          pageCount={dashboard.pageCount}
          totalEntries={dashboard.totalEntries}
          cachedCount={dashboard.cachedCount}
        />
      )}
    </div>
  );
}

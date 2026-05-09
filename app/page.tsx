import {
  getCachedDashboardStats,
  getHourDashboard,
} from "@/lib/analyze";
import { ComplianceSection } from "@/components/ComplianceSection";
import { DatePicker } from "@/components/DatePicker";
import { formatRelative } from "@/lib/utils";
import { readCachedSlugVerdicts } from "@/lib/gemini";
import { findUsersForBylines, listUsers, type User } from "@/lib/users";
import { listEditors } from "@/lib/editors";
import { listSections } from "@/lib/sections";
import { clampDateToWindow, dayHeaderLabel, todayInIST } from "@/lib/dates";

// No caching. Every page load re-queries Supabase so editors always
// see the latest cron-tick state without any staleness window.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const RETENTION_DAYS = 7;

type SearchParams = Promise<{
  /** 0–23 IST hour. If absent, server auto-picks the latest hour
   *  with articles. Replaces the old ?page= scheme. */
  hour?: string;
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

  // Parse the requested hour if present. Anything missing or invalid
  // becomes `null` — the server will auto-pick the most recent hour
  // that actually has articles.
  let requestedHour: number | null = null;
  if (typeof sp.hour === "string") {
    const n = parseInt(sp.hour, 10);
    if (Number.isFinite(n) && n >= 0 && n < 24) requestedHour = n;
  }

  const dashboard = await getHourDashboard({
    date: istDate,
    requestedHour,
  });

  // Aggregate stats across all of the chosen day's stored articles, for
  // the Top Issues panel. Independent of which hour is being viewed.
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

  const [sectionRows, allActiveUsers, allEditors] = await Promise.all([
    listSections({ activeOnly: true }),
    listUsers(),
    listEditors({ activeOnly: true }),
  ]);
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
              {dashboard.totalForDate.toLocaleString()}
            </span>
            {sitemapTotal > dashboard.totalForDate ? (
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
      {dashboard.totalForDate === 0 ? (
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
          allUsers={allAuthorOptions}
          slugVerdicts={slugVerdicts}
          userMap={userMap}
          editorCount={editorCount}
          hour={dashboard.hour}
          countsPerHour={dashboard.countsPerHour}
          totalForDate={dashboard.totalForDate}
        />
      )}
    </div>
  );
}

import Link from "next/link";

/**
 * Shown when getArticleAnalysisById() returns null — meaning the
 * routing-id either:
 *   • doesn't match anything in the articles table (could be a bad
 *     bookmark, an article we never scraped, or a typo), OR
 *   • matched an article that was purged by the 7-day retention
 *     window (we keep the last 7 IST days only).
 *
 * Replaces the bare default Next.js "404 — page not found" so the
 * editor knows whether to wait for the next cron tick, paste the URL
 * again, or accept that the piece has aged out.
 */
export default function ArticleNotFound() {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 space-y-5 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        That article isn&apos;t in the dashboard
      </h1>
      <p className="text-sm text-muted leading-relaxed">
        Either the cron hasn&apos;t scraped it yet (it ticks once an
        hour), or it was published more than 7 days ago — we only keep
        the last 7 IST days of articles before purging them.
      </p>
      <p className="text-sm text-muted leading-relaxed">
        If you came here from a bookmark, that&apos;s probably the
        retention rolloff. Otherwise check back after the next cron
        tick.
      </p>
      <div className="flex items-center justify-center gap-3 pt-4">
        <Link
          href="/"
          className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-stone-800"
        >
          ← Back to today&apos;s overview
        </Link>
        <Link
          href="/settings"
          className="rounded-md border bg-card px-4 py-2 text-sm hover:bg-stone-50"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}

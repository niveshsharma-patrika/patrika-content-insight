/**
 * Shown while the Settings page boots. Settings runs six parallel
 * Supabase queries (config, users, sections, cron runs, gemini usage,
 * lifetime gemini) on each render — without a loading state the page
 * looked frozen for the duration. The skeleton matches the five-card
 * stack the real page renders so the layout doesn't jump on hand-off.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6 animate-pulse">
      <div className="h-4 w-32 rounded bg-stone-200" />
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-stone-200" />
        <div className="h-4 w-96 max-w-full rounded bg-stone-200" />
      </div>

      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border bg-card overflow-hidden"
          aria-hidden="true"
        >
          <div className="h-12 border-b bg-stone-50/60 px-5 flex items-center">
            <div className="h-4 w-32 rounded bg-stone-200" />
          </div>
          <div className="p-5 space-y-3">
            <div className="h-4 w-full rounded bg-stone-100" />
            <div className="h-4 w-5/6 rounded bg-stone-100" />
            <div className="h-4 w-4/6 rounded bg-stone-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

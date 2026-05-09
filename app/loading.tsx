/**
 * Shown by Next.js App Router while the home page server component is
 * still rendering on the way in (and during ?date=… or ?page=…
 * navigations). Without this file the user sees a blank, frozen tab
 * for ~200–800ms with no feedback that anything is happening.
 *
 * The skeleton mirrors the real page's gross layout (date header →
 * picker → stat line → grid) so the perceived jump on hand-off is
 * minimal. All elements are tinted background only — no text — so the
 * Settings cog and logo remain obviously interactive in the masthead.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-8 animate-pulse">
      <div className="space-y-3">
        <div className="h-7 w-64 rounded bg-stone-200" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-7 w-20 rounded-md bg-stone-200" />
          ))}
        </div>
        <div className="h-4 w-80 rounded bg-stone-200" />
      </div>

      <div className="rounded-xl border bg-card p-5 space-y-3">
        <div className="h-5 w-40 rounded bg-stone-200" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-md bg-stone-100" />
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border bg-card overflow-hidden"
            aria-hidden="true"
          >
            <div className="h-9 border-b bg-stone-50/60" />
            <div className="p-4 space-y-3">
              <div className="h-4 w-3/4 rounded bg-stone-200" />
              <div className="h-4 w-2/3 rounded bg-stone-200" />
              <div className="h-3 w-1/2 rounded bg-stone-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

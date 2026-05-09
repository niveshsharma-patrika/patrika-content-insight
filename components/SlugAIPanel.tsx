import type { SlugVerdict } from "@/lib/gemini";

/**
 * Display-only summary of the Gemini slug verdict for the article.
 *
 * The cron auto-evaluates every freshly-scraped slug, so by the time
 * the editor opens an article detail page the verdict is already
 * cached in `slug_verdicts`. This panel just renders it. There is no
 * "Check now" button — that was a relic of the manual era; today the
 * dashboard never calls Gemini at request time.
 */

const VERDICT_BADGE: Record<SlugVerdict["verdict"], string> = {
  clear: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  hinglish: "bg-sky-50 text-sky-700 ring-sky-200",
  gibberish: "bg-red-50 text-red-700 ring-red-200",
};

const LANG_LABEL: Record<SlugVerdict["language"], string> = {
  english: "English",
  hinglish: "Hinglish",
  mixed: "Mixed",
  unknown: "Unknown",
};

export function SlugAIPanel({
  hasGeminiKey,
  verdict,
}: {
  hasGeminiKey: boolean;
  verdict: SlugVerdict | null;
}) {
  // No key configured anywhere — show a one-liner pointing at the env
  // var, since it's the only place the key now lives.
  if (!hasGeminiKey) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold text-sm mb-1">URL slug · AI verdict</h3>
        <p className="text-xs text-muted">
          Set the{" "}
          <span className="font-mono">GEMINI_API_KEY</span> environment
          variable to enable AI slug analysis. Once set, the cron
          classifies every new article&apos;s URL automatically.
        </p>
      </div>
    );
  }

  // Key is configured but the cron hasn't gotten to this slug yet.
  // (Edge case: article scraped before Gemini was wired up, or a
  // transient Gemini error on its tick.)
  if (!verdict) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-semibold text-sm mb-1">URL slug · AI verdict</h3>
        <p className="text-xs text-muted">
          Pending — the cron will classify this slug on its next tick.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <h3 className="font-semibold text-sm">URL slug · AI verdict</h3>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            VERDICT_BADGE[verdict.verdict]
          }`}
        >
          {verdict.verdict}
        </span>
        <span className="text-xs text-muted">
          · score{" "}
          <span className="font-semibold tabular-nums text-foreground">
            {verdict.score}/100
          </span>
        </span>
        <span className="text-xs text-muted">
          · language{" "}
          <span className="font-medium text-foreground">
            {LANG_LABEL[verdict.language]}
          </span>
        </span>
      </div>

      {verdict.notes ? (
        <p className="text-sm leading-snug bg-stone-50 rounded-md px-3 py-2 border border-stone-200">
          {verdict.notes}
        </p>
      ) : null}

      <div className="font-mono text-[11px] text-muted break-all">
        slug: {verdict.slug}
      </div>
    </div>
  );
}

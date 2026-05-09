"use client";

import { useState } from "react";
import type { SlugVerdict } from "@/lib/gemini";

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
  articleUrl,
  hasGeminiKey,
  initialVerdict,
}: {
  articleUrl: string;
  hasGeminiKey: boolean;
  initialVerdict: SlugVerdict | null;
}) {
  const [verdict, setVerdict] = useState<SlugVerdict | null>(initialVerdict);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(force = false) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/gemini/slugs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force, urls: [articleUrl] }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok)
        throw new Error(data.error ?? "Gemini request failed");
      const v = data.verdicts?.[articleUrl];
      if (!v) throw new Error("Gemini returned no verdict for this URL");
      setVerdict(v);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (!hasGeminiKey) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="font-semibold text-sm">URL slug · AI verdict</h3>
          <a
            href="/settings"
            className="text-xs text-accent hover:underline underline-offset-2"
          >
            Add Gemini key →
          </a>
        </div>
        <p className="text-xs text-muted">
          Add a Gemini API key in Settings to get an AI verdict on this slug
          (clear / hinglish / gibberish), separate from the heuristic rule.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-sm">URL slug · AI verdict</h3>
        <div className="flex items-center gap-2">
          {verdict ? (
            <button
              type="button"
              onClick={() => run(true)}
              disabled={loading}
              className="text-xs text-muted hover:text-foreground disabled:opacity-60"
            >
              {loading ? "Re-checking…" : "Force re-check"}
            </button>
          ) : null}
        </div>
      </div>

      {!verdict ? (
        <div>
          <p className="text-xs text-muted mb-3">
            Send this slug to Gemini for a clear/hinglish/gibberish verdict +
            a 0–100 readability score.
          </p>
          <button
            type="button"
            onClick={() => run(false)}
            disabled={loading}
            className="rounded-md bg-accent text-accent-fg px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {loading ? "Checking…" : "Check with Gemini"}
          </button>
        </div>
      ) : (
        <div className="space-y-2 text-sm">
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
      )}

      {error ? (
        <div className="rounded-md bg-red-50 text-red-800 text-xs px-3 py-2 mt-2">
          {error}
        </div>
      ) : null}
    </div>
  );
}

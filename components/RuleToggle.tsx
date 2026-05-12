"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * On/off switch for a single rule. Optimistically flips the visible
 * state, then PATCHes /api/rules/[id]. On success we refresh the route
 * so any other UI surface (rule counts in the header) recomputes from
 * the server. On failure we revert and surface the error.
 *
 * A disabled rule contributes nothing to the editorial / SEO score,
 * isn't counted in violation totals, never becomes a "top issue", and
 * never triggers a Telegram nudge.
 */
export function RuleToggle({
  ruleId,
  initialEnabled,
}: {
  ruleId: string;
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const r = await fetch(`/api/rules/${encodeURIComponent(ruleId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !data.ok) {
        // Revert optimistic update.
        setEnabled(!next);
        setError(data.error ?? "Toggle failed");
        return;
      }
      // Refresh server components so the page header's count updates.
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={enabled ? "Disable rule" : "Enable rule"}
        onClick={toggle}
        disabled={pending}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          enabled ? "bg-emerald-500" : "bg-stone-300"
        } disabled:opacity-60`}
      >
        <span
          className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </button>
      <span
        className={`text-[10px] uppercase tracking-wide font-medium ${
          enabled ? "text-emerald-700" : "text-stone-500"
        }`}
      >
        {enabled ? "On" : "Off"}
      </span>
      {error ? (
        <span className="text-[10px] text-red-700" title={error}>
          ⚠ {error.slice(0, 40)}
        </span>
      ) : null}
    </div>
  );
}

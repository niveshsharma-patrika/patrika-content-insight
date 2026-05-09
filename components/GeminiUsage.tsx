import {
  estimateCostUsd,
  GEMINI_INPUT_USD_PER_1M,
  GEMINI_OUTPUT_USD_PER_1M,
  type GeminiUsageRow,
} from "@/lib/geminiUsage";

/**
 * Read-only summary of Gemini token usage + an approximate USD cost.
 * Server-rendered. Pricing constants come from the same module that
 * does the recording, so the cost shown stays in sync if pricing
 * changes.
 */
export function GeminiUsage({
  rows,
  lifetime,
}: {
  /** Last N days of per-day usage rows, newest-first. */
  rows: GeminiUsageRow[];
  /** Aggregate across the entire `gemini_usage` table. */
  lifetime: { promptTokens: number; outputTokens: number; requestCount: number };
}) {
  const today = rows[0];
  const todayPrompt = today?.promptTokens ?? 0;
  const todayOutput = today?.outputTokens ?? 0;
  const todayCost = estimateCostUsd(todayPrompt, todayOutput);

  let weekPrompt = 0;
  let weekOutput = 0;
  let weekRequests = 0;
  for (const r of rows) {
    weekPrompt += r.promptTokens;
    weekOutput += r.outputTokens;
    weekRequests += r.requestCount;
  }
  const weekCost = estimateCostUsd(weekPrompt, weekOutput);
  const lifetimeCost = estimateCostUsd(
    lifetime.promptTokens,
    lifetime.outputTokens,
  );

  const hasData = lifetime.requestCount > 0;

  return (
    <section className="rounded-xl border bg-card overflow-hidden">
      <header className="px-5 py-3 border-b bg-stone-50/60">
        <h2 className="font-semibold">Gemini usage</h2>
        <p className="text-xs text-muted mt-1">
          URL slugs are sent to Gemini 2.5 Flash by the cron. Cost is
          estimated at{" "}
          <span className="font-mono">
            ${GEMINI_INPUT_USD_PER_1M.toFixed(3)}
          </span>{" "}
          per 1M input tokens and{" "}
          <span className="font-mono">
            ${GEMINI_OUTPUT_USD_PER_1M.toFixed(2)}
          </span>{" "}
          per 1M output tokens.
        </p>
      </header>

      {!hasData ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No Gemini calls recorded yet. The cron starts logging tokens on
          its next tick that processes a slug.
        </p>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x">
            <Stat
              label="Today"
              tokens={todayPrompt + todayOutput}
              breakdown={`${todayPrompt.toLocaleString()} in · ${todayOutput.toLocaleString()} out`}
              cost={todayCost}
              requests={today?.requestCount ?? 0}
            />
            <Stat
              label={`Last ${rows.length} day${rows.length === 1 ? "" : "s"}`}
              tokens={weekPrompt + weekOutput}
              breakdown={`${weekPrompt.toLocaleString()} in · ${weekOutput.toLocaleString()} out`}
              cost={weekCost}
              requests={weekRequests}
            />
            <Stat
              label="Lifetime"
              tokens={lifetime.promptTokens + lifetime.outputTokens}
              breakdown={`${lifetime.promptTokens.toLocaleString()} in · ${lifetime.outputTokens.toLocaleString()} out`}
              cost={lifetimeCost}
              requests={lifetime.requestCount}
            />
          </div>

          {rows.length > 0 ? (
            <div className="border-t">
              <div className="px-5 py-2 bg-stone-50/30 text-[10px] uppercase tracking-wider text-muted font-medium">
                By day
              </div>
              <ul className="divide-y">
                {rows.map((r) => {
                  const cost = estimateCostUsd(
                    r.promptTokens,
                    r.outputTokens,
                  );
                  return (
                    <li
                      key={r.date}
                      className="px-5 py-2 flex items-center gap-4 text-xs flex-wrap"
                    >
                      <span className="font-mono w-24 tabular-nums">
                        {r.date}
                      </span>
                      <span className="text-muted tabular-nums">
                        {(
                          r.promptTokens + r.outputTokens
                        ).toLocaleString()}{" "}
                        tokens
                      </span>
                      <span className="text-muted text-[11px]">
                        {r.requestCount} call
                        {r.requestCount === 1 ? "" : "s"}
                      </span>
                      <span className="ml-auto font-mono tabular-nums text-stone-700">
                        {formatUsd(cost)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Stat({
  label,
  tokens,
  breakdown,
  cost,
  requests,
}: {
  label: string;
  tokens: number;
  breakdown: string;
  cost: number;
  requests: number;
}) {
  return (
    <div className="px-5 py-4 space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-muted font-medium">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">
        {tokens.toLocaleString()}
      </div>
      <div className="text-[11px] text-muted">{breakdown}</div>
      <div className="text-xs font-mono tabular-nums">
        ≈ {formatUsd(cost)} · {requests.toLocaleString()} call
        {requests === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

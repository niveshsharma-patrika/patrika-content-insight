import { getDb } from "./db";
import { todayInIST } from "./dates";

/**
 * Per-day Gemini token accounting.
 *
 * Every batch the cron sends to Gemini reports `usageMetadata` (prompt
 * + output tokens). We accumulate that per IST date, then summarize it
 * in Settings → Gemini usage with an approximate USD cost.
 *
 * Pricing constants live here so the dashboard's cost estimate stays
 * close to whatever Gemini 2.5 Flash actually charges. If pricing
 * shifts, update these.
 */

// Gemini 2.5 Flash pricing, USD per 1 million tokens (text I/O).
// Update if Google's pricing page changes.
export const GEMINI_INPUT_USD_PER_1M = 0.075;
export const GEMINI_OUTPUT_USD_PER_1M = 0.3;

export type GeminiUsageRow = {
  date: string; // YYYY-MM-DD (IST)
  promptTokens: number;
  outputTokens: number;
  requestCount: number;
  updatedAt: string;
};

type Row = {
  date: string;
  prompt_tokens: number | string;
  output_tokens: number | string;
  request_count: number;
  updated_at: string;
};

function fromRow(r: Row): GeminiUsageRow {
  return {
    date: r.date,
    promptTokens: Number(r.prompt_tokens) || 0,
    outputTokens: Number(r.output_tokens) || 0,
    requestCount: r.request_count ?? 0,
    updatedAt: r.updated_at,
  };
}

export function estimateCostUsd(
  promptTokens: number,
  outputTokens: number,
): number {
  return (
    (promptTokens / 1_000_000) * GEMINI_INPUT_USD_PER_1M +
    (outputTokens / 1_000_000) * GEMINI_OUTPUT_USD_PER_1M
  );
}

/**
 * Add the given token counts to today's row (IST). Creates the row if
 * absent. Safe to call multiple times per cron tick — each batch's
 * tokens accumulate.
 */
export async function recordGeminiUsage(
  promptTokens: number,
  outputTokens: number,
  requestCount: number = 1,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  if (promptTokens <= 0 && outputTokens <= 0) return;

  const date = todayInIST();
  // Read current totals (if any), then upsert with the new sums.
  // Supabase doesn't expose atomic INCREMENT via the REST client, so we
  // read-modify-write. Cron is single-flight per tick, so the race is
  // theoretical; if it ever matters we move this to an RPC.
  const { data } = await db
    .from("gemini_usage")
    .select("prompt_tokens,output_tokens,request_count")
    .eq("date", date)
    .maybeSingle();
  const cur = (data ?? {
    prompt_tokens: 0,
    output_tokens: 0,
    request_count: 0,
  }) as { prompt_tokens: number; output_tokens: number; request_count: number };

  const { error } = await db.from("gemini_usage").upsert(
    {
      date,
      prompt_tokens: Number(cur.prompt_tokens) + promptTokens,
      output_tokens: Number(cur.output_tokens) + outputTokens,
      request_count: (cur.request_count ?? 0) + requestCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "date" },
  );
  if (error) {
    console.error(
      "[geminiUsage.recordGeminiUsage] upsert failed:",
      error.message,
    );
  }
}

/**
 * Read the last N days of usage rows, newest-first. Empty array if no
 * data or DB not configured.
 */
export async function listGeminiUsage(
  days: number = 7,
): Promise<GeminiUsageRow[]> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from("gemini_usage")
    .select("*")
    .order("date", { ascending: false })
    .limit(days);
  if (error || !data) return [];
  return (data as Row[]).map(fromRow);
}

/**
 * Lifetime totals across every day in the table.
 */
export async function getLifetimeGeminiUsage(): Promise<{
  promptTokens: number;
  outputTokens: number;
  requestCount: number;
}> {
  const db = getDb();
  if (!db) return { promptTokens: 0, outputTokens: 0, requestCount: 0 };
  const { data, error } = await db
    .from("gemini_usage")
    .select("prompt_tokens,output_tokens,request_count");
  if (error || !data) {
    return { promptTokens: 0, outputTokens: 0, requestCount: 0 };
  }
  let p = 0;
  let o = 0;
  let r = 0;
  for (const row of data as Row[]) {
    p += Number(row.prompt_tokens) || 0;
    o += Number(row.output_tokens) || 0;
    r += row.request_count ?? 0;
  }
  return { promptTokens: p, outputTokens: o, requestCount: r };
}

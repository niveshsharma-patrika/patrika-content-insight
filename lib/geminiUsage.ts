import { sql, sqlOne, exec, getPool } from "./db";
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
  if (!getPool()) return;
  if (promptTokens <= 0 && outputTokens <= 0) return;

  const date = todayInIST();
  // Atomic accumulate: upsert that ADDS the new tokens to whatever is
  // already stored for this IST date. Postgres does the read-modify-write
  // in a single statement, so concurrent ticks can't clobber each other.
  try {
    await exec(
      `INSERT INTO gemini_usage (date, prompt_tokens, output_tokens, request_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (date) DO UPDATE SET
         prompt_tokens = gemini_usage.prompt_tokens + EXCLUDED.prompt_tokens,
         output_tokens = gemini_usage.output_tokens + EXCLUDED.output_tokens,
         request_count = gemini_usage.request_count + EXCLUDED.request_count,
         updated_at = NOW()`,
      [date, promptTokens, outputTokens, requestCount],
    );
  } catch (err) {
    console.error(
      "[geminiUsage.recordGeminiUsage] upsert failed:",
      err instanceof Error ? err.message : String(err),
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
  if (!getPool()) return [];
  try {
    const rows = await sql<Row>(
      `SELECT * FROM gemini_usage ORDER BY date DESC LIMIT $1`,
      [days],
    );
    return rows.map(fromRow);
  } catch (err) {
    console.error(
      "[geminiUsage.listGeminiUsage] select failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * Lifetime totals across every day in the table.
 */
export async function getLifetimeGeminiUsage(): Promise<{
  promptTokens: number;
  outputTokens: number;
  requestCount: number;
}> {
  if (!getPool()) return { promptTokens: 0, outputTokens: 0, requestCount: 0 };
  try {
    const row = await sqlOne<{
      prompt_tokens: number;
      output_tokens: number;
      request_count: number;
    }>(
      `SELECT
         COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
         COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
         COALESCE(SUM(request_count), 0)::int    AS request_count
       FROM gemini_usage`,
    );
    return {
      promptTokens: Number(row?.prompt_tokens) || 0,
      outputTokens: Number(row?.output_tokens) || 0,
      requestCount: Number(row?.request_count) || 0,
    };
  } catch (err) {
    console.error(
      "[geminiUsage.getLifetimeGeminiUsage] select failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { promptTokens: 0, outputTokens: 0, requestCount: 0 };
  }
}

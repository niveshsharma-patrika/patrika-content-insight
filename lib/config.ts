/**
 * App-level configuration.
 *
 * BOTH credentials live in environment variables, never on disk and
 * never editable through the UI:
 *
 *   GEMINI_API_KEY     — required for URL slug analysis
 *   GEMINI_MODEL       — optional (defaults to gemini-2.5-flash)
 *   TELEGRAM_BOT_TOKEN — required for author nudges
 *
 * The Settings page only shows whether each is set; to change a value,
 * edit `.env.local` (dev) or the Vercel project env vars (prod) and
 * restart.
 */

const DEFAULT_MODEL = "gemini-2.5-flash";

export type AppConfig = {
  geminiApiKey?: string;
  geminiModel: string;
  telegramBotToken?: string;
};

export async function getConfig(): Promise<AppConfig> {
  return {
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
    geminiModel: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined,
  };
}

export function maskKey(key?: string): string {
  if (!key) return "—";
  if (key.length < 12) return "•".repeat(key.length);
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

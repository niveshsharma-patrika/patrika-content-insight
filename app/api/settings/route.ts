import { NextResponse } from "next/server";
import { getConfig, maskKey } from "@/lib/config";

/**
 * Read-only settings endpoint.
 *
 * Both Gemini and Telegram credentials are env-var-only now, so POST
 * returns 400 in every case — there is nothing to save through the UI.
 * The Settings page uses GET for status display.
 */

export async function GET() {
  const cfg = await getConfig();
  return NextResponse.json({
    hasGeminiKey: !!cfg.geminiApiKey,
    geminiKeyMask: maskKey(cfg.geminiApiKey),
    geminiModel: cfg.geminiModel,
    hasTelegramToken: !!cfg.telegramBotToken,
    telegramTokenMask: maskKey(cfg.telegramBotToken),
  });
}

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Credentials are configured via environment variables (GEMINI_API_KEY, TELEGRAM_BOT_TOKEN). Edit .env.local or your Vercel project env and restart.",
    },
    { status: 400 },
  );
}

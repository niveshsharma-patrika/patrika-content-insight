import { NextResponse } from "next/server";
import { getBotInfo, isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";

export async function GET() {
  if (!(await isTelegramConfigured())) {
    return NextResponse.json(
      { ok: false, error: "Telegram bot token not configured" },
      { status: 400 },
    );
  }
  try {
    const info = await getBotInfo();
    return NextResponse.json({ ok: true, bot: info });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const chatId =
    typeof body?.chatId === "string" && body.chatId.trim()
      ? body.chatId.trim()
      : undefined;
  if (!chatId) {
    return NextResponse.json(
      { ok: false, error: "chatId required" },
      { status: 400 },
    );
  }
  try {
    const r = await sendTelegramMessage(
      chatId,
      "✅ Test message from <b>Patrika Insight</b>. The bot can reach this chat.",
    );
    return NextResponse.json({ ok: true, messageId: r.messageId });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}

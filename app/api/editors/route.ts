import { NextResponse } from "next/server";
import { listEditors, upsertEditor } from "@/lib/editors";

export async function GET() {
  const editors = await listEditors();
  return NextResponse.json({ ok: true, editors });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !body ||
    typeof body.name !== "string" ||
    !body.name.trim() ||
    typeof body.telegramChatId !== "string" ||
    !body.telegramChatId.trim()
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Both name and Telegram chat ID are required",
      },
      { status: 400 },
    );
  }
  try {
    const editor = await upsertEditor({
      id: typeof body.id === "string" ? body.id : undefined,
      name: body.name,
      telegramChatId: body.telegramChatId,
      active: typeof body.active === "boolean" ? body.active : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return NextResponse.json({ ok: true, editor });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}

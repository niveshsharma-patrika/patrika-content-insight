import { NextResponse } from "next/server";
import { listEditors, upsertEditor, type EditorRole } from "@/lib/editors";

export async function GET() {
  const editors = await listEditors();
  return NextResponse.json({ ok: true, editors });
}

/**
 * Sanitize roles[] in a POST body. Accept only the two known role
 * literals; drop everything else. If the resulting array is empty
 * we return undefined so upsertEditor's normalizer applies its
 * default ('editorial') — never let a caller save zero roles.
 */
function parseRoles(raw: unknown): EditorRole[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: EditorRole[] = [];
  for (const v of raw) {
    if (v === "editorial" || v === "seo") {
      if (!out.includes(v)) out.push(v);
    }
  }
  return out.length > 0 ? out : undefined;
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
      roles: parseRoles(body.roles),
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

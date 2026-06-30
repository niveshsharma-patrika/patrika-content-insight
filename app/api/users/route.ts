import { NextResponse } from "next/server";
import { listUsers, upsertUser } from "@/lib/users";
import { requireRole } from "@/lib/session";

export async function GET() {
  const users = await listUsers();
  return NextResponse.json({ ok: true, users });
}

export async function POST(req: Request) {
  const gate = await requireRole("editor");
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json(
      { ok: false, error: "Name is required" },
      { status: 400 },
    );
  }
  const aliases = Array.isArray(body.aliases)
    ? (body.aliases as unknown[]).filter(
        (a): a is string => typeof a === "string",
      )
    : typeof body.aliases === "string"
      ? (body.aliases as string)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  try {
    const user = await upsertUser({
      id: typeof body.id === "string" ? body.id : undefined,
      name: body.name,
      aliases,
      telegramChatId:
        typeof body.telegramChatId === "string"
          ? body.telegramChatId
          : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });
    return NextResponse.json({ ok: true, user });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 400 },
    );
  }
}

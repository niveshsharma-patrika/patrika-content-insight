import { NextResponse } from "next/server";
import { updateSection } from "@/lib/sections";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "Invalid body" },
      { status: 400 },
    );
  }
  const patch: { displayName?: string; active?: boolean } = {};
  if (typeof body.displayName === "string") patch.displayName = body.displayName;
  if (typeof body.active === "boolean") patch.active = body.active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "Nothing to update" },
      { status: 400 },
    );
  }
  const updated = await updateSection(id, patch);
  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "Section not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, section: updated });
}

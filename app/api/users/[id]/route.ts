import { NextResponse } from "next/server";
import { deleteUser } from "@/lib/users";
import { requireRole } from "@/lib/session";

type Params = Promise<{ id: string }>;

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const gate = await requireRole("editor");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  await deleteUser(id);
  return NextResponse.json({ ok: true });
}

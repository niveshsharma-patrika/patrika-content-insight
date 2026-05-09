import { NextResponse } from "next/server";
import { deleteEditor } from "@/lib/editors";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteEditor(id);
  return NextResponse.json({ ok: true });
}

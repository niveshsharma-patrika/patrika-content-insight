import { NextResponse } from "next/server";
import { deleteUser } from "@/lib/users";

type Params = Promise<{ id: string }>;

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const { id } = await params;
  await deleteUser(id);
  return NextResponse.json({ ok: true });
}

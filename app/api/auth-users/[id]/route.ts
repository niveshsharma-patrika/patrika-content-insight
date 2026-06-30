import { NextResponse } from "next/server";
import { requireRole } from "@/lib/session";
import { deleteDashboardUser } from "@/lib/dashboardUsers";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/auth-users/[id] — remove a login user (admin only). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireRole("admin");
  if (!gate.ok) return gate.response;
  const { id } = await params;
  await deleteDashboardUser(id);
  return NextResponse.json({ ok: true });
}

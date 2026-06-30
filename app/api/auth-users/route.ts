import { NextResponse } from "next/server";
import { isRole } from "@/lib/auth";
import { requireRole } from "@/lib/session";
import {
  createDashboardUser,
  listDashboardUsers,
  updateDashboardUser,
} from "@/lib/dashboardUsers";

export const dynamic = "force-dynamic";

/** GET /api/auth-users — list login users (admin only). */
export async function GET() {
  const gate = await requireRole("admin");
  if (!gate.ok) return gate.response;
  const users = await listDashboardUsers();
  return NextResponse.json({ ok: true, users });
}

/**
 * POST /api/auth-users (admin only)
 *   create: { username, password, role }
 *   update: { id, role?, active?, password? }
 */
export async function POST(req: Request) {
  const gate = await requireRole("admin");
  if (!gate.ok) return gate.response;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Bad body" }, { status: 400 });

  // Update path.
  if (typeof body.id === "string") {
    const patch: { role?: "admin" | "editor" | "viewer"; active?: boolean; password?: string } = {};
    if (body.role !== undefined) {
      if (!isRole(body.role))
        return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
      patch.role = body.role;
    }
    if (typeof body.active === "boolean") patch.active = body.active;
    if (typeof body.password === "string" && body.password) patch.password = body.password;
    const res = await updateDashboardUser(body.id, patch);
    if (!res.ok) return NextResponse.json(res, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // Create path.
  if (typeof body.username !== "string" || typeof body.password !== "string") {
    return NextResponse.json(
      { ok: false, error: "username and password are required" },
      { status: 400 },
    );
  }
  if (!isRole(body.role)) {
    return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
  }
  const res = await createDashboardUser({
    username: body.username,
    password: body.password,
    role: body.role,
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  return NextResponse.json({ ok: true, user: res.user });
}

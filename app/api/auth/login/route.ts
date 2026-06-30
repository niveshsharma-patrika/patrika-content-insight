import { NextResponse } from "next/server";
import {
  buildSetCookieHeader,
  createSessionCookieValue,
  isAuthConfigured,
} from "@/lib/auth";
import { authenticateUser } from "@/lib/dashboardUsers";

/**
 * POST /api/auth/login
 * body: { username: string, password: string }
 *
 * On success: 200 { ok: true } + Set-Cookie: pci_session=...
 * On failure: 401 { ok: false, error: "..." }
 *
 * If DASHBOARD_USERNAME / DASHBOARD_PASSWORD aren't both set in the
 * environment, auth is considered "off" and any submission succeeds —
 * matches the proxy's behavior. That keeps the app usable in dev when
 * nobody has bothered to set credentials.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (
    !body ||
    typeof body.username !== "string" ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json(
      { ok: false, error: "Username and password are required." },
      { status: 400 },
    );
  }

  const submittedUser = body.username.trim();
  const submittedPass = body.password;

  if (!isAuthConfigured()) {
    // No credentials configured — same behavior as the proxy: pass.
    // We still set a session cookie so the redirect doesn't loop. Dev
    // sessions are admins so the whole app is exercisable locally.
    const cookieValue = await createSessionCookieValue(
      submittedUser || "anonymous",
      "admin",
    );
    const res = NextResponse.json({ ok: true, user: submittedUser, role: "admin" });
    res.headers.set("set-cookie", buildSetCookieHeader(cookieValue));
    return res;
  }

  // Check DB users first, then fall back to the env break-glass admin.
  const identity = await authenticateUser(submittedUser, submittedPass);
  if (!identity) {
    return NextResponse.json(
      { ok: false, error: "Incorrect username or password." },
      { status: 401 },
    );
  }

  const cookieValue = await createSessionCookieValue(identity.user, identity.role);
  const res = NextResponse.json({ ok: true, user: identity.user, role: identity.role });
  res.headers.set("set-cookie", buildSetCookieHeader(cookieValue));
  return res;
}

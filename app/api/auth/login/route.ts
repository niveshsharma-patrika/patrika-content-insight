import { NextResponse } from "next/server";
import {
  buildSetCookieHeader,
  constantTimeEq,
  createSessionCookieValue,
  isAuthConfigured,
} from "@/lib/auth";

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
    // We still set a session cookie so the redirect doesn't loop.
    const cookieValue = await createSessionCookieValue(
      submittedUser || "anonymous",
    );
    const res = NextResponse.json({ ok: true, user: submittedUser });
    res.headers.set("set-cookie", buildSetCookieHeader(cookieValue));
    return res;
  }

  const expectedUser = process.env.DASHBOARD_USERNAME!.trim();
  const expectedPass = process.env.DASHBOARD_PASSWORD!;

  if (
    !constantTimeEq(submittedUser, expectedUser) ||
    !constantTimeEq(submittedPass, expectedPass)
  ) {
    return NextResponse.json(
      { ok: false, error: "Incorrect username or password." },
      { status: 401 },
    );
  }

  const cookieValue = await createSessionCookieValue(expectedUser);
  const res = NextResponse.json({ ok: true, user: expectedUser });
  res.headers.set("set-cookie", buildSetCookieHeader(cookieValue));
  return res;
}

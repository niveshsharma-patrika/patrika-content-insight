/**
 * Server-side session access for RSCs and Node route handlers.
 *
 * `proxy.ts` (Edge) already authenticated the request; these helpers
 * decode the same signed cookie to recover *who* the user is and their
 * role, so pages can conditionally render and API routes can authorize.
 */

import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  isAuthConfigured,
  roleAtLeast,
  verifySessionCookieValue,
  type Role,
} from "./auth";

export type ServerSession = { user: string; role: Role };

/**
 * Current session, or null if not logged in. When auth isn't configured
 * (dev convenience — same as the proxy/login passthrough) returns a
 * synthetic admin so the whole app stays usable.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  if (!isAuthConfigured()) return { user: "dev", role: "admin" };
  const store = await cookies();
  const value = store.get(SESSION_COOKIE_NAME)?.value;
  const payload = await verifySessionCookieValue(value);
  if (!payload) return null;
  return { user: payload.user, role: payload.role };
}

/**
 * Authorization guard for API route handlers. Returns the session when
 * the caller is at least `min` rank, otherwise a ready-to-return JSON
 * error Response (401 if not logged in, 403 if under-privileged).
 *
 *   const gate = await requireRole("editor");
 *   if (!gate.ok) return gate.response;
 *   // gate.session is the authorized ServerSession
 */
export async function requireRole(
  min: Role,
): Promise<
  { ok: true; session: ServerSession } | { ok: false; response: Response }
> {
  const session = await getServerSession();
  if (!session) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: "Not authenticated" },
        { status: 401 },
      ),
    };
  }
  if (!roleAtLeast(session.role, min)) {
    return {
      ok: false,
      response: Response.json(
        { ok: false, error: `Requires ${min} access` },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session };
}

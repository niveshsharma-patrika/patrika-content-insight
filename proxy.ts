import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  isAuthConfigured,
  verifySessionCookieValue,
} from "@/lib/auth";

/**
 * Project-wide auth gate (Next 16's `proxy.ts` = what used to be
 * `middleware.ts`).
 *
 * Flow:
 *   1. Bypass cron + auth endpoints + the login page + static assets.
 *   2. If credentials aren't configured (DASHBOARD_USERNAME +
 *      DASHBOARD_PASSWORD), let everyone through. Logs a warning on
 *      the home page so a misconfigured deploy is visible.
 *   3. Read the `pci_session` cookie. If it verifies, pass.
 *   4. Otherwise redirect to /login?next=<original path>. The login
 *      form posts to /api/auth/login, which sets the cookie, then
 *      window.location.href = next to re-run this proxy.
 */

// Paths the proxy must never gate.
//   PUBLIC_EXACT — match the path exactly.
//   PUBLIC_PREFIXES — match if pathname starts with the listed string
//                     (always end the entry with "/" to avoid
//                     accidentally matching "/login123" via "/login").
const PUBLIC_EXACT = new Set<string>(["/login"]);
const PUBLIC_PREFIXES = [
  "/api/cron/", // Vercel Cron uses its own Bearer token
  "/api/auth/", // login + logout endpoints
];

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_EXACT.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (!isAuthConfigured()) {
    // Auth not configured → let traffic through. Warn on the home
    // page render so a sysadmin notices in production logs.
    if (pathname === "/") {
      console.warn(
        "[proxy] DASHBOARD_USERNAME / DASHBOARD_PASSWORD not set — auth gate is OFF.",
      );
    }
    return NextResponse.next();
  }

  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifySessionCookieValue(cookie);
  if (session) {
    return NextResponse.next();
  }

  // No valid session. For HTML page navigations, redirect to /login.
  // For API requests (likely fetch() from a client component), we
  // return 401 JSON instead of a redirect so the client surface can
  // show a useful error.
  const isApi = pathname.startsWith("/api/");
  if (isApi) {
    return new NextResponse(
      JSON.stringify({ ok: false, error: "Not authenticated" }),
      {
        status: 401,
        headers: { "content-type": "application/json" },
      },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + (search || ""))}`;
  return NextResponse.redirect(url);
}

/**
 * Matcher excludes Next's internal asset routes and the favicon so
 * the proxy never runs on CDN-served files. Everything else — pages,
 * API routes, RSC payloads — gets the auth check.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|patrika-logo.png|icon.png).*)"],
};

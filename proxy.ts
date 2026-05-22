import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Project-wide auth gate.
 *
 * In Next.js 16 what used to live in `middleware.ts` is now in
 * `proxy.ts` (same mechanism, renamed). This file enforces HTTP Basic
 * authentication on every request EXCEPT:
 *
 *   • /api/cron/*  — Vercel Cron hits these with its own
 *                    `Authorization: Bearer ${CRON_SECRET}` header.
 *                    Adding Basic Auth on top would replace that
 *                    header and break the cron entirely.
 *   • Next.js internals (_next/static, _next/image) — public assets
 *                    served straight from the CDN; never gated.
 *   • favicon.ico  — same reason.
 *
 * Credentials come from env vars:
 *   DASHBOARD_USERNAME / DASHBOARD_PASSWORD
 *
 * If either is missing in the environment we DO NOT lock the app —
 * we log a warning and let traffic through. That way a misconfigured
 * deploy doesn't 401 everyone before someone can fix the env vars.
 * (Set both in Vercel project settings to actually enable the gate.)
 *
 * The browser handles the prompt + credential caching natively, so
 * there's no /login page, no session table, nothing to clear on
 * logout — users just close the tab.
 */

const REALM = "Patrika Content Insight";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Bypass cron routes — they authenticate via CRON_SECRET bearer.
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  const expectedUser = process.env.DASHBOARD_USERNAME?.trim();
  const expectedPass = process.env.DASHBOARD_PASSWORD;

  // If the env vars aren't both set, leave the gate open and warn
  // loudly in the logs. Better than locking the entire team out
  // because of a typo in Vercel env config.
  if (!expectedUser || !expectedPass) {
    if (pathname === "/") {
      console.warn(
        "[proxy] DASHBOARD_USERNAME / DASHBOARD_PASSWORD not set — auth gate is OFF.",
      );
    }
    return NextResponse.next();
  }

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const encoded = header.slice("Basic ".length).trim();
    let decoded = "";
    try {
      // atob is available in both Node 20+ and the Edge runtime.
      decoded = atob(encoded);
    } catch {
      // Malformed base64 — fall through to the 401 below.
    }
    const idx = decoded.indexOf(":");
    if (idx >= 0) {
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (
        constantTimeEq(user, expectedUser) &&
        constantTimeEq(pass, expectedPass)
      ) {
        return NextResponse.next();
      }
    }
  }

  // Either no header or the credentials didn't match — challenge.
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

/**
 * Comparing the supplied password to the expected one with `===` is
 * vulnerable to a timing oracle — the first mismatched character
 * returns faster than a full match. Constant-time string equality
 * removes that signal. Probably overkill for a dashboard but it's
 * literally five lines.
 */
function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Matcher excludes Next's internal asset routes and the favicon so
 * the proxy never runs on CDN-served files. Everything else — pages,
 * API routes, RSC payloads — gets the auth check.
 *
 * The negative-lookahead `(?!_next/static|_next/image|favicon.ico)`
 * is the canonical Next.js pattern for "everything except…".
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

import { NextResponse } from "next/server";
import { buildClearCookieHeader } from "@/lib/auth";

/**
 * POST /api/auth/logout
 * Clears the pci_session cookie. Returns { ok: true }.
 * The client is expected to redirect to /login afterwards.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.set("set-cookie", buildClearCookieHeader());
  return res;
}

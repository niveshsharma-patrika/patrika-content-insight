import { NextResponse } from "next/server";
import { fetchSitemap } from "@/lib/sitemap";
import { checkSlugsWithGemini, readCachedSlugVerdicts } from "@/lib/gemini";
import { requireRole } from "@/lib/session";

export async function POST(req: Request) {
  const gate = await requireRole("editor");
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const force = !!body.force;
  // How many of the latest sitemap entries to evaluate. Default 200.
  const limit =
    typeof body.limit === "number"
      ? Math.min(Math.max(body.limit, 5), 1000)
      : 200;

  // If `urls` is supplied, evaluate just those (used by SlugAIPanel for one URL).
  const explicit = Array.isArray(body.urls)
    ? (body.urls as unknown[]).filter(
        (u): u is string => typeof u === "string" && u.length > 0,
      )
    : null;

  let urls: string[];
  if (explicit && explicit.length > 0) {
    urls = explicit;
  } else {
    // Always pull a fresh sitemap. lib/sitemap's in-memory module
    // cache (5 min) could otherwise hide URLs that just landed.
    const entries = await fetchSitemap({ forceRefresh: true });
    urls = entries.slice(0, limit).map((e) => e.url);
  }

  try {
    const verdicts = await checkSlugsWithGemini(urls, { force });
    return NextResponse.json({
      ok: true,
      count: Object.keys(verdicts).length,
      verdicts,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function GET() {
  const entries = await fetchSitemap({ forceRefresh: true });
  const verdicts = await readCachedSlugVerdicts(
    entries.slice(0, 200).map((e) => e.url),
  );
  return NextResponse.json({ ok: true, verdicts });
}

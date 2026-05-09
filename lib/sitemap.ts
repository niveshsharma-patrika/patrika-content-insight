import { XMLParser } from "fast-xml-parser";
import type { SitemapEntry } from "./types";
import { todayInIST } from "./dates";

// Re-exported for callers that previously imported from this module.
export { todayInIST };

export const SITEMAP_URL =
  "https://www.patrika.com/google-news-sitemap-v1.xml";

let sitemapCache: { entries: SitemapEntry[]; fetchedAt: number } | null = null;
const SITEMAP_TTL_MS = 5 * 60 * 1000; // 5 min

export async function fetchSitemap(opts?: {
  forceRefresh?: boolean;
}): Promise<SitemapEntry[]> {
  if (
    !opts?.forceRefresh &&
    sitemapCache &&
    Date.now() - sitemapCache.fetchedAt < SITEMAP_TTL_MS
  ) {
    return sitemapCache.entries;
  }
  const res = await fetch(SITEMAP_URL, {
    next: { revalidate: 300 },
    headers: {
      "User-Agent":
        "PatrikaContentInsight/1.0 (editorial QA dashboard; contact ops)",
    },
  });
  if (!res.ok) {
    throw new Error(`Sitemap fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml);
  const urlset = parsed?.urlset?.url;
  const rows: unknown[] = Array.isArray(urlset) ? urlset : urlset ? [urlset] : [];
  const entries: SitemapEntry[] = rows.map((row) => {
    const r = row as Record<string, unknown>;
    const news = (r.news ?? {}) as Record<string, unknown>;
    const pub = (news.publication ?? {}) as Record<string, unknown>;
    return {
      url: String(r.loc ?? ""),
      publishedAt: String(news.publication_date ?? r.lastmod ?? ""),
      title: String(news.title ?? ""),
      language: String(pub.language ?? "hi"),
      keywords: news.keywords ? String(news.keywords) : undefined,
      genres: news.genres ? String(news.genres) : undefined,
    };
  });
  const sorted = entries
    .filter((e) => e.url)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  sitemapCache = { entries: sorted, fetchedAt: Date.now() };
  return sorted;
}

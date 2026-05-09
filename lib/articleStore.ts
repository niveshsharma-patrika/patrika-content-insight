import { getDb } from "./db";
import type { ScrapedArticle, SitemapEntry } from "./types";
import { categoryFromUrl } from "./utils";
import { articleId as computeArticleId } from "./articleId";

// 6-hour TTL — articles get small edits in the first hours after publish
// (alt-text fixes, image swaps, headline tweaks) and rarely after that.
const TTL_MS = 6 * 60 * 60 * 1000;

type ArticleRow = {
  url: string;
  article_id: string | null;
  category: string | null;
  sitemap_title: string | null;
  sitemap_published_at: string | null;
  scraped_at: string; // ISO timestamp
  ok: boolean;
  scrape_error: string | null;
  h1_title: string | null;
  meta_description: string | null;
  word_count: number | null;
  internal_link_count: number | null;
  has_read_also: boolean | null;
  author: string | null;
  author_link: string | null;
  published_at: string | null;
  modified_at: string | null;
  og_image: string | null;
  payload: ScrapedArticle;
};

/**
 * Reconstruct a SitemapEntry-shape from a stored article row. The rule
 * engine and the dashboard render components both expect this shape;
 * since we no longer fetch the live sitemap on each page render, we
 * synthesize it from the columns we captured at scrape time.
 */
export function rowToSitemapEntry(row: ArticleRow): SitemapEntry {
  return {
    url: row.url,
    publishedAt:
      row.sitemap_published_at ??
      row.published_at ??
      new Date(0).toISOString(),
    title: row.sitemap_title ?? row.h1_title ?? "",
    language: row.payload.language ?? "hi",
  };
}

export type StoredArticle = {
  entry: SitemapEntry;
  article: ScrapedArticle;
};

function toScraped(row: ArticleRow): ScrapedArticle {
  // The full ScrapedArticle is preserved verbatim in `payload` for the
  // rule engine. The flat columns are only used for SQL filtering/sorting.
  return row.payload;
}

/**
 * Read a single article. Returns null when the URL is not in the DB or
 * when the cached scrape is older than the TTL.
 */
export async function readArticle(url: string): Promise<ScrapedArticle | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from("articles")
    .select("*")
    .eq("url", url)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ArticleRow;
  const ageMs = Date.now() - new Date(row.scraped_at).getTime();
  if (ageMs > TTL_MS) return null;
  return toScraped(row);
}

/**
 * Persist a scraped article. We denormalize the hot-path columns for
 * indexed queries; the full payload stays in JSONB.
 */
export async function writeArticle(
  url: string,
  article: ScrapedArticle,
  sitemapMeta?: { title?: string; publishedAt?: string },
): Promise<void> {
  const db = getDb();
  if (!db) return;
  const intro = article.paragraphs?.[0]?.text ?? "";
  void intro; // reserved for future fts/snippet use
  const row: Omit<ArticleRow, "scraped_at"> & { scraped_at?: string } = {
    url,
    article_id: computeArticleId(url),
    category: categoryFromUrl(url) || null,
    sitemap_title: sitemapMeta?.title ?? null,
    sitemap_published_at: parseIso(sitemapMeta?.publishedAt),
    ok: !!article.ok,
    scrape_error: article.error ?? null,
    h1_title: article.title ?? null,
    meta_description: article.metaDescription ?? null,
    word_count: typeof article.wordCount === "number" ? article.wordCount : null,
    internal_link_count:
      typeof article.internalLinkCount === "number"
        ? article.internalLinkCount
        : null,
    has_read_also: !!article.hasReadAlso,
    author: article.author ?? null,
    author_link: article.authorLink ?? null,
    // Prefer the article's own publishedAt (from JSON-LD / meta tags) but
    // fall back to the sitemap's publication_date — the sitemap is always
    // present, the in-page date isn't always extractable. Without this
    // fallback the published_at column ends up null and the dashboard's
    // "today" filter finds no rows.
    published_at:
      parseIso(article.publishedAt) ?? parseIso(sitemapMeta?.publishedAt),
    modified_at: parseIso(article.modifiedAt),
    og_image: article.ogImage ?? null,
    payload: article,
    scraped_at: new Date().toISOString(),
  };
  const { error } = await db.from("articles").upsert(row, { onConflict: "url" });
  if (error) {
    console.error("[articleStore.writeArticle] upsert failed:", error.message);
  }
}

/**
 * Bulk read — returns a Map<url, ScrapedArticle> for fresh-enough rows.
 * Stale rows are filtered out (treated as cache misses).
 */
export async function readManyArticles(
  urls: string[],
): Promise<Map<string, ScrapedArticle>> {
  const out = new Map<string, ScrapedArticle>();
  if (urls.length === 0) return out;
  const db = getDb();
  if (!db) return out;

  const cutoffIso = new Date(Date.now() - TTL_MS).toISOString();
  // Supabase has a URL-length limit on `in` filters. Chunk to be safe.
  const CHUNK = 200;
  for (let i = 0; i < urls.length; i += CHUNK) {
    const slice = urls.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("articles")
      .select("*")
      .in("url", slice)
      .gte("scraped_at", cutoffIso);
    if (error) {
      console.error(
        "[articleStore.readManyArticles] select failed:",
        error.message,
      );
      continue;
    }
    for (const row of (data ?? []) as ArticleRow[]) {
      out.set(row.url, toScraped(row));
    }
  }
  return out;
}

/**
 * Delete an article (and its scores + rule_results via FK cascade).
 */
export async function deleteArticle(url: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  const { error } = await db.from("articles").delete().eq("url", url);
  if (error) {
    console.error("[articleStore.deleteArticle] failed:", error.message);
  }
}

/**
 * Delete every article whose `published_at` falls before midnight IST
 * of `cutoffIstDate`. Used by the cron to enforce the 7-day retention
 * window. `article_scores` and `rule_results` cascade automatically
 * via FK ON DELETE.
 *
 * Returns the number of rows deleted.
 */
export async function purgeArticlesOlderThan(
  cutoffIstDate: string,
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const cutoffIso = `${cutoffIstDate}T00:00:00+05:30`;
  const { error, count } = await db
    .from("articles")
    .delete({ count: "exact" })
    .lt("published_at", cutoffIso);
  if (error) {
    console.error(
      "[articleStore.purgeArticlesOlderThan] failed:",
      error.message,
    );
    return 0;
  }
  return count ?? 0;
}

/**
 * Wipe the entire articles table. Used by the "force refresh" path.
 */
export async function clearStore(): Promise<void> {
  const db = getDb();
  if (!db) return;
  // Supabase requires a filter; delete-all via a tautology.
  const { error } = await db.from("articles").delete().not("url", "is", null);
  if (error) {
    console.error("[articleStore.clearStore] failed:", error.message);
  }
}

/**
 * Read all articles whose published_at falls inside the given IST date
 * window (00:00–24:00 IST). The dashboard uses this as its sole source
 * of "what was published today" — no live sitemap fetch on render.
 *
 * Returns rows newest-first (matches the dashboard's worst/freshest
 * priority list).
 */
export async function readArticlesForIstDate(
  istDate: string,
): Promise<StoredArticle[]> {
  const db = getDb();
  if (!db) return [];
  const startIso = `${istDate}T00:00:00+05:30`;
  const endIso = new Date(
    new Date(startIso).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await db
    .from("articles")
    .select("*")
    .gte("published_at", startIso)
    .lt("published_at", endIso)
    .order("published_at", { ascending: false });
  if (error || !data) return [];
  return (data as ArticleRow[]).map((row) => ({
    entry: rowToSitemapEntry(row),
    article: row.payload,
  }));
}

/**
 * Look up a stored article by its routing id (the slug-derived hash
 * computed by `articleId(url)`). Returns null when nothing matches.
 */
export async function readArticleById(
  id: string,
): Promise<StoredArticle | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from("articles")
    .select("*")
    .eq("article_id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ArticleRow;
  return { entry: rowToSitemapEntry(row), article: row.payload };
}

/**
 * Returns the max(published_at) across all stored articles, as an ISO
 * string — or null if the table is empty. The cron job uses this as the
 * "only scrape stuff newer than this" watermark.
 */
export async function getLatestPublishedAt(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from("articles")
    .select("published_at")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { published_at: string | null };
  return row.published_at ?? null;
}

/**
 * Count rows in the articles table (used for the "X scraped & cached"
 * indicator on the dashboard header).
 */
export async function storeSize(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const { count, error } = await db
    .from("articles")
    .select("url", { count: "exact", head: true });
  if (error) return 0;
  return count ?? 0;
}

// ---------- helpers ----------

function parseIso(v?: string | null): string | null {
  if (!v) return null;
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString();
}

import { sql, sqlOne, exec, getPool } from "./db";
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
  /** True the second time (or later) the cron scrapes this URL — i.e.
   *  Patrika bumped its publish-timestamp and we picked it up again.
   *  Drives the "Updated" tag on the dashboard. */
  is_updated: boolean | null;
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
  /** True if the cron has scraped this URL more than once — the second
   *  scrape happens because Patrika bumped its publish-time, so this
   *  flag means "Patrika edited / re-published this article". */
  isUpdated: boolean;
};

function toStored(row: ArticleRow): StoredArticle {
  return {
    entry: rowToSitemapEntry(row),
    article: row.payload,
    isUpdated: row.is_updated ?? false,
  };
}

/**
 * Read a single article. Returns null when the URL is not in the DB or
 * when the cached scrape is older than the TTL.
 */
export async function readArticle(url: string): Promise<ScrapedArticle | null> {
  const row = await sqlOne<ArticleRow>(
    `SELECT * FROM articles WHERE url = $1`,
    [url],
  );
  if (!row) return null;
  const ageMs = Date.now() - new Date(row.scraped_at).getTime();
  if (ageMs > TTL_MS) return null;
  return row.payload;
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
  if (!getPool()) return;

  // Detect a genuine Patrika edit, not just a re-call of writeArticle.
  // We mark `is_updated = true` only when:
  //   • the URL is already in the DB (existing row), AND
  //   • either the new sitemap publish-time differs from what we
  //     stored before, or the article's own modified_at moved past
  //     its published_at.
  // Otherwise the flag would flip on any backfill / manual rescrape.
  const newSitemapPub =
    parseIso(sitemapMeta?.publishedAt) ?? parseIso(article.publishedAt);
  const newModified = parseIso(article.modifiedAt);
  const newPublished = parseIso(article.publishedAt);

  const existingRow = await sqlOne<{
    sitemap_published_at: string | null;
    published_at: string | null;
    is_updated: boolean | null;
  }>(
    `SELECT sitemap_published_at, published_at, is_updated FROM articles WHERE url = $1`,
    [url],
  );

  let isUpdate = false;
  if (existingRow) {
    const prevSitemapMs = existingRow.sitemap_published_at
      ? new Date(existingRow.sitemap_published_at).getTime()
      : null;
    const newSitemapMs = newSitemapPub ? new Date(newSitemapPub).getTime() : null;
    const sitemapBumped =
      prevSitemapMs !== null &&
      newSitemapMs !== null &&
      newSitemapMs !== prevSitemapMs;
    const modifiedAfterPublish =
      !!(newModified && newPublished) &&
      new Date(newModified).getTime() >
        new Date(newPublished).getTime() + 60 * 1000;
    // Sticky: stay updated once flagged.
    isUpdate =
      sitemapBumped || modifiedAfterPublish || existingRow.is_updated === true;
  }

  const values = [
    url, // $1
    computeArticleId(url), // $2
    categoryFromUrl(url) || null, // $3
    sitemapMeta?.title ?? null, // $4
    parseIso(sitemapMeta?.publishedAt), // $5
    !!article.ok, // $6
    article.error ?? null, // $7
    article.title ?? null, // $8
    article.metaDescription ?? null, // $9
    typeof article.wordCount === "number" ? article.wordCount : null, // $10
    typeof article.internalLinkCount === "number"
      ? article.internalLinkCount
      : null, // $11
    !!article.hasReadAlso, // $12
    article.author ?? null, // $13
    article.authorLink ?? null, // $14
    // Prefer the article's own publishedAt, fall back to sitemap date.
    parseIso(article.publishedAt) ?? parseIso(sitemapMeta?.publishedAt), // $15
    parseIso(article.modifiedAt), // $16
    article.ogImage ?? null, // $17
    isUpdate, // $18
    JSON.stringify(article), // $19 (jsonb)
    new Date().toISOString(), // $20 scraped_at
  ];

  try {
    await exec(
      `INSERT INTO articles (
         url, article_id, category, sitemap_title, sitemap_published_at,
         ok, scrape_error, h1_title, meta_description, word_count,
         internal_link_count, has_read_also, author, author_link, published_at,
         modified_at, og_image, is_updated, payload, scraped_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
         $11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20
       )
       ON CONFLICT (url) DO UPDATE SET
         article_id = EXCLUDED.article_id,
         category = EXCLUDED.category,
         sitemap_title = EXCLUDED.sitemap_title,
         sitemap_published_at = EXCLUDED.sitemap_published_at,
         ok = EXCLUDED.ok,
         scrape_error = EXCLUDED.scrape_error,
         h1_title = EXCLUDED.h1_title,
         meta_description = EXCLUDED.meta_description,
         word_count = EXCLUDED.word_count,
         internal_link_count = EXCLUDED.internal_link_count,
         has_read_also = EXCLUDED.has_read_also,
         author = EXCLUDED.author,
         author_link = EXCLUDED.author_link,
         published_at = EXCLUDED.published_at,
         modified_at = EXCLUDED.modified_at,
         og_image = EXCLUDED.og_image,
         is_updated = EXCLUDED.is_updated,
         payload = EXCLUDED.payload,
         scraped_at = EXCLUDED.scraped_at`,
      values,
    );
  } catch (err) {
    console.error(
      "[articleStore.writeArticle] upsert failed:",
      err instanceof Error ? err.message : String(err),
    );
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
  if (urls.length === 0 || !getPool()) return out;
  const cutoffIso = new Date(Date.now() - TTL_MS).toISOString();
  try {
    const rows = await sql<ArticleRow>(
      `SELECT * FROM articles WHERE url = ANY($1::text[]) AND scraped_at >= $2`,
      [urls, cutoffIso],
    );
    for (const row of rows) out.set(row.url, row.payload);
  } catch (err) {
    console.error(
      "[articleStore.readManyArticles] select failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return out;
}

/** Delete an article (and its scores + rule_results via FK cascade). */
export async function deleteArticle(url: string): Promise<void> {
  await exec(`DELETE FROM articles WHERE url = $1`, [url]);
}

/**
 * Delete every article whose `published_at` falls before midnight IST
 * of `cutoffIstDate`. `article_scores` and `rule_results` cascade
 * automatically via FK ON DELETE. Returns the number of rows deleted.
 */
export async function purgeArticlesOlderThan(
  cutoffIstDate: string,
): Promise<number> {
  if (!getPool()) return 0;
  const cutoffIso = `${cutoffIstDate}T00:00:00+05:30`;
  let deleted = 0;
  try {
    // 1) Normal case: published_at is set → purge by it.
    deleted += await exec(`DELETE FROM articles WHERE published_at < $1`, [
      cutoffIso,
    ]);
    // 2) Orphans whose published_at is NULL never trip the `<` filter
    //    (null-comparison is UNKNOWN). Catch them via scraped_at.
    deleted += await exec(
      `DELETE FROM articles WHERE published_at IS NULL AND scraped_at < $1`,
      [cutoffIso],
    );
  } catch (err) {
    console.error(
      "[articleStore.purgeArticlesOlderThan] failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
  return deleted;
}

/** Wipe the entire articles table. Used by the "force refresh" path. */
export async function clearStore(): Promise<void> {
  await exec(`DELETE FROM articles`);
}

/**
 * Read all articles whose published_at falls inside the given IST date
 * window (00:00–24:00 IST), newest-first.
 */
export async function readArticlesForIstDate(
  istDate: string,
  opts?: { offset?: number; limit?: number },
): Promise<StoredArticle[]> {
  if (!getPool()) return [];
  const startIso = `${istDate}T00:00:00+05:30`;
  const endIso = new Date(
    new Date(startIso).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  let query = `SELECT * FROM articles
               WHERE published_at >= $1 AND published_at < $2
               ORDER BY published_at DESC`;
  const params: unknown[] = [startIso, endIso];
  if (typeof opts?.offset === "number" && typeof opts?.limit === "number") {
    query += ` LIMIT $3 OFFSET $4`;
    params.push(opts.limit, opts.offset);
  }
  const rows = await sql<ArticleRow>(query, params);
  return rows.map(toStored);
}

/**
 * Read articles whose published_at falls inside a specific IST hour
 * (`istHour:00:00 → istHour+1:00:00`), newest-first.
 */
export async function readArticlesForIstHour(
  istDate: string,
  istHour: number,
): Promise<StoredArticle[]> {
  if (!getPool()) return [];
  const hh = String(Math.max(0, Math.min(23, istHour))).padStart(2, "0");
  const startIso = `${istDate}T${hh}:00:00+05:30`;
  const endIso = new Date(
    new Date(startIso).getTime() + 60 * 60 * 1000,
  ).toISOString();
  const rows = await sql<ArticleRow>(
    `SELECT * FROM articles
     WHERE published_at >= $1 AND published_at < $2
     ORDER BY published_at DESC`,
    [startIso, endIso],
  );
  return rows.map(toStored);
}

/**
 * Read JUST the published_at timestamps for the day, no payloads.
 */
export async function readPublishedAtsForIstDate(
  istDate: string,
): Promise<string[]> {
  if (!getPool()) return [];
  const startIso = `${istDate}T00:00:00+05:30`;
  const endIso = new Date(
    new Date(startIso).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const rows = await sql<{ published_at: string | null }>(
    `SELECT published_at FROM articles
     WHERE published_at >= $1 AND published_at < $2`,
    [startIso, endIso],
  );
  return rows.map((r) => r.published_at).filter((s): s is string => !!s);
}

/** Count articles in the IST date window without pulling row payloads. */
export async function countArticlesForIstDate(
  istDate: string,
): Promise<number> {
  if (!getPool()) return 0;
  const startIso = `${istDate}T00:00:00+05:30`;
  const endIso = new Date(
    new Date(startIso).getTime() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const row = await sqlOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM articles
     WHERE published_at >= $1 AND published_at < $2`,
    [startIso, endIso],
  );
  return row?.n ?? 0;
}

/**
 * Look up a stored article by its routing id (the slug-derived hash).
 */
export async function readArticleById(
  id: string,
): Promise<StoredArticle | null> {
  const row = await sqlOne<ArticleRow>(
    `SELECT * FROM articles WHERE article_id = $1`,
    [id],
  );
  return row ? toStored(row) : null;
}

/**
 * Returns the max(published_at) across all stored articles, or null if
 * empty. The cron uses this as the "only scrape newer than this" mark.
 */
export async function getLatestPublishedAt(): Promise<string | null> {
  const row = await sqlOne<{ published_at: string | null }>(
    `SELECT published_at FROM articles
     WHERE published_at IS NOT NULL
     ORDER BY published_at DESC LIMIT 1`,
  );
  return row?.published_at ?? null;
}

/** Count rows in the articles table. */
export async function storeSize(): Promise<number> {
  const row = await sqlOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM articles`,
  );
  return row?.n ?? 0;
}

// ---------- helpers ----------

function parseIso(v?: string | null): string | null {
  if (!v) return null;
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString();
}

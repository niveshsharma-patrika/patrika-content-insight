import * as cheerio from "cheerio";
import type {
  AnchorIssue,
  ArticleEmbed,
  ArticleImage,
  Paragraph,
  ScrapedArticle,
  StructuredData,
} from "./types";

const FETCH_TIMEOUT_MS = 25000;

function wordCount(text: string): number {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return 0;
  return cleaned.split(" ").length;
}

function basename(src: string): string {
  try {
    const u = new URL(src, "https://www.patrika.com");
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return last;
  } catch {
    return src.split("/").filter(Boolean).pop() ?? "";
  }
}

// Site chrome (logos, nav icons, language switcher) get scraped along with
// real article images on Patrika. Skip them so they don't pollute the alt-text
// / dimensions / filename checks.
const SYSTEM_FILENAMES = new Set([
  "patrika-logo.webp",
  "patrika-logo.png",
  "patrika-logo.jpg",
  "language-swith-english.webp",
  "language-swith-hindi.webp",
  "language-switch-english.webp",
  "language-switch-hindi.webp",
  "shorts-gray.svg",
  "video.svg",
  "webstory-gray.svg",
  "epaper.svg",
  "mynewsactive.svg",
  // Footer / publisher / store badges
  "publisher.webp",
  "publisher.png",
  "publisher.jpg",
  "googlepublisher.webp",
  "googlepublisher.png",
  "ass.png",
  "appstore.png",
  "appstore.webp",
  "playstore.png",
  "playstore.webp",
  "google-play.png",
  "google-play.webp",
  "app-store.png",
  "app-store.webp",
]);

const SYSTEM_FILENAME_PATTERNS: RegExp[] = [
  /^patrika[-_]logo/i,
  /^language[-_]swit[hc]h?[-.]/i,
  /-(gray|active|inactive|hover|icon)\.(svg|png|webp|jpe?g)$/i,
  /(active|inactive|gray|hover)\.svg$/i,
  /\bsprite\b/i,
  /^favicon/i,
  // Footer badges
  /^google[-_]?publisher/i,
  /^app[-_]?store/i,
  /^play[-_]?store/i,
  /^google[-_]?play/i,
];

const SYSTEM_PATH_PATTERNS: RegExp[] = [
  /\/icons?\//i,
  /\/static\/(?:icons?|svg|sprites?|chrome)\//i,
  /\/assets\/(?:icons?|svg|sprites?|chrome)\//i,
  /\/_next\/static\//i,
];

function isSystemImage(
  filename: string,
  src: string,
  width?: number,
  declaredWidth?: string,
): boolean {
  const lower = (filename || "").toLowerCase();
  if (!lower) return false;
  // SVGs on a news site are virtually always UI icons, not article images.
  if (lower.endsWith(".svg")) return true;
  if (SYSTEM_FILENAMES.has(lower)) return true;
  if (SYSTEM_FILENAME_PATTERNS.some((p) => p.test(filename))) return true;
  if (SYSTEM_PATH_PATTERNS.some((p) => p.test(src))) return true;
  // ?w=150 (or any narrow width param) → a thumbnail served for related/widget
  // cards, not a body image. Patrika uses ?w=150 for "यह भी पढ़ें" cards.
  const wParam = src.match(/[?&]w=(\d+)/);
  if (wParam && parseInt(wParam[1], 10) <= 200) return true;
  // Tiny declared images (badges, social icons)
  if (typeof width === "number" && width > 0 && width <= 80) return true;
  if (declaredWidth) {
    const w = parseInt(declaredWidth, 10);
    if (Number.isFinite(w) && w <= 80) return true;
  }
  return false;
}

function intOrUndef(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

export async function scrapeArticle(url: string): Promise<ScrapedArticle> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 PatrikaContentInsight/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      next: { revalidate: 1800 },
    });
    if (!res.ok) {
      return makeError(url, fetchedAt, `HTTP ${res.status}`);
    }
    const html = await res.text();
    return parseArticleHtml(url, fetchedAt, html);
  } catch (err) {
    return makeError(url, fetchedAt, (err as Error).message);
  } finally {
    clearTimeout(timeout);
  }
}

function emptyStructured(): StructuredData {
  return {
    hasNewsArticle: false,
    hasArticle: false,
    hasBreadcrumb: false,
  };
}

function makeError(url: string, fetchedAt: string, error: string): ScrapedArticle {
  return {
    url,
    fetchedAt,
    ok: false,
    error,
    title: "",
    metaTitle: "",
    metaDescription: "",
    hreflangs: [],
    hasMaxImagePreviewLarge: false,
    bodyText: "",
    bodyHtml: "",
    paragraphs: [],
    h1Count: 0,
    h2Count: 0,
    h2Headings: [],
    headingSequence: [],
    images: [],
    embeds: [],
    internalLinkCount: 0,
    externalLinkCount: 0,
    hasReadAlso: false,
    wordCount: 0,
    structuredData: emptyStructured(),
    weakAnchors: [],
    mixedContentImageCount: 0,
    unsafeExternalLinkCount: 0,
  };
}

function findArticleRoot($: cheerio.CheerioAPI): cheerio.Cheerio<never> {
  const candidates = [
    "article",
    "[itemprop='articleBody']",
    "[class*='article-body']",
    "[class*='article_body']",
    "[class*='story-content']",
    "[class*='story_content']",
    "[class*='storybody']", // Patrika CSS-module: storybody_component_container__…
    "[class*='story_body']",
    "[class*='content-area']",
    "main",
  ];
  for (const sel of candidates) {
    const node = $(sel).first();
    if (node.length && node.find("p").length >= 2) {
      return node as unknown as cheerio.Cheerio<never>;
    }
  }
  return $("body") as unknown as cheerio.Cheerio<never>;
}

function extractStructuredData($: cheerio.CheerioAPI): StructuredData {
  const out: StructuredData = emptyStructured();
  const blocks: string[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt) return;
    blocks.push(txt);
  });
  if (!blocks.length) return out;
  out.raw = blocks.join("\n").slice(0, 50000);

  function visit(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    const types: string[] = Array.isArray(t)
      ? t.map(String)
      : typeof t === "string"
        ? [t]
        : [];
    const isNews = types.some((x) => /NewsArticle/i.test(x));
    const isArticle = types.some((x) => /^(Article|BlogPosting|ReportageNewsArticle)$/i.test(x));
    const isBreadcrumb = types.some((x) => /BreadcrumbList/i.test(x));
    if (isBreadcrumb) out.hasBreadcrumb = true;
    if (isNews) out.hasNewsArticle = true;
    if (isArticle || isNews) {
      out.hasArticle = true;
      if (!out.schemaType) out.schemaType = types.join(", ");
      if (typeof obj.headline === "string" && !out.headline)
        out.headline = obj.headline;
      if (typeof obj.datePublished === "string" && !out.datePublished)
        out.datePublished = obj.datePublished;
      if (typeof obj.dateModified === "string" && !out.dateModified)
        out.dateModified = obj.dateModified;
      const author = obj.author;
      if (author) {
        const a = Array.isArray(author) ? author[0] : author;
        if (a && typeof a === "object") {
          const ao = a as Record<string, unknown>;
          if (typeof ao["@type"] === "string") out.authorType = ao["@type"];
          if (typeof ao.name === "string") out.authorName = ao.name;
          if (typeof ao.url === "string") out.authorUrl = ao.url;
        } else if (typeof a === "string") {
          out.authorName = a;
        }
      }
      const publisher = obj.publisher;
      if (publisher && typeof publisher === "object") {
        const po = publisher as Record<string, unknown>;
        if (typeof po.name === "string") out.publisherName = po.name;
        const logo = po.logo;
        if (logo && typeof logo === "object") {
          const lo = logo as Record<string, unknown>;
          if (typeof lo.url === "string") out.publisherLogo = lo.url;
        } else if (typeof logo === "string") {
          out.publisherLogo = logo;
        }
      }
      const img = obj.image;
      if (img) {
        if (typeof img === "string") out.imageInSchema = img;
        else if (Array.isArray(img) && typeof img[0] === "string")
          out.imageInSchema = img[0];
        else if (typeof img === "object") {
          const io = img as Record<string, unknown>;
          if (typeof io.url === "string") out.imageInSchema = io.url;
        }
      }
    }
    // Walk @graph and nested objects
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") visit(v);
    }
  }

  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      visit(parsed);
    } catch {
      // ignore JSON parse errors
    }
  }
  return out;
}

function parseArticleHtml(
  url: string,
  fetchedAt: string,
  html: string,
): ScrapedArticle {
  const $ = cheerio.load(html);

  const title = $("h1").first().text().trim() || $("title").text().trim();
  const h1Count = $("h1").length;
  const metaTitle = ($("title").text() || "").trim();
  const metaDescription =
    $("meta[name='description']").attr("content")?.trim() ?? "";
  const ogTitle = $("meta[property='og:title']").attr("content")?.trim();
  const ogDescription = $("meta[property='og:description']")
    .attr("content")
    ?.trim();
  const ogImage = $("meta[property='og:image']").attr("content")?.trim();
  const twitterCard = $("meta[name='twitter:card']").attr("content")?.trim();
  const twitterImage = $("meta[name='twitter:image']").attr("content")?.trim();
  const canonical = $("link[rel='canonical']").attr("href")?.trim();
  const robotsMeta = $("meta[name='robots']").attr("content")?.trim();
  const hasMaxImagePreviewLarge = !!robotsMeta?.match(/max-image-preview\s*:\s*large/i);
  const language =
    $("html").attr("lang")?.trim() ||
    $("meta[http-equiv='content-language']").attr("content")?.trim();

  const hreflangs: string[] = [];
  $("link[rel='alternate'][hreflang]").each((_, el) => {
    const v = $(el).attr("hreflang");
    if (v) hreflangs.push(v);
  });

  const viewport = $("meta[name='viewport']").attr("content")?.trim();
  const charset =
    $("meta[charset]").attr("charset")?.trim() ||
    (() => {
      const ct = $("meta[http-equiv='Content-Type']").attr("content") ?? "";
      const m = ct.match(/charset=([\w-]+)/i);
      return m ? m[1] : undefined;
    })();
  let pageProtocol: "http" | "https" | undefined;
  try {
    pageProtocol = (new URL(url).protocol === "https:" ? "https" : "http");
  } catch {
    // ignore
  }

  // Parse JSON-LD first — it's the source of truth on Patrika and most modern
  // publishers (Next.js sites where the byline isn't in server-rendered HTML).
  const structuredData = extractStructuredData($);

  // Author byline. Order:
  //   1. JSON-LD NewsArticle.author.name
  //   2. <meta name="author">
  //   3. <meta property="article:author">
  //   4. Author profile <a href="/author/...">
  //   5. <[rel='author']> visible text
  //   6. Tight class match — only nodes whose class actually contains a "byline"
  //      / "author-name" token, not arbitrary "author-..."" wrappers.
  const articleAuthorMeta = $("meta[property='article:author']")
    .attr("content")
    ?.trim();
  const profileAnchor = $("a[href*='/author/']").first();
  const profileText = profileAnchor.text().replace(/\s+/g, " ").trim();
  const profileHref = profileAnchor.attr("href")?.trim();

  function tightDomByline(): string | undefined {
    // Only consider elements whose class contains author-name / authorname /
    // byline / writer / reporter as a separate hyphen/underscore token. This
    // avoids matching marketing wrappers like "author-bio-card" with junk text.
    const $node = $(
      "[class*='author-name'],[class*='authorName'],[class~='byline'],[class*='-byline'],[class*='_byline']",
    ).first();
    if (!$node.length) return undefined;
    const t = $node.text().replace(/\s+/g, " ").trim();
    // Reject anything that's clearly not a name (too long, has numbers / pipes).
    if (!t || t.length > 80 || /[\d|]/.test(t)) return undefined;
    return t;
  }

  const author =
    structuredData.authorName ||
    $("meta[name='author']").attr("content")?.trim() ||
    articleAuthorMeta ||
    (profileText && profileText.length <= 80 ? profileText : undefined) ||
    $("[rel='author']").first().text().replace(/\s+/g, " ").trim() ||
    tightDomByline();

  const authorLink =
    structuredData.authorUrl ||
    $("[rel='author']").first().attr("href")?.trim() ||
    profileHref;

  const publishedAt =
    $("meta[property='article:published_time']").attr("content")?.trim() ||
    $("time[datetime]").first().attr("datetime")?.trim();
  const modifiedAt =
    $("meta[property='article:modified_time']").attr("content")?.trim() ||
    $("meta[property='og:updated_time']").attr("content")?.trim();

  const root = findArticleRoot($);

  // Collect paragraphs from anywhere on the page that's INSIDE any
  // article-body container, then deduplicate. We used to limit search
  // to the single `root` element returned by findArticleRoot, but
  // Patrika's story layout sometimes spreads paragraphs across
  // multiple sibling `storybody_text` chunks that aren't descendants
  // of the first matched root. Result: word counts coming back ~40%
  // short on longer pieces.
  //
  // Two-pass approach:
  //   1. Take every paragraph already inside `root`.
  //   2. Add any extra paragraphs that live inside a storybody_*
  //      / article-body / story-content container ANYWHERE on the
  //      page, skipping the related/aside/footer/nav junk.
  //   3. De-dupe by exact text so we never double-count a paragraph
  //      that happens to live under both the root and a
  //      storybody_text leaf.
  const rawParas: Paragraph[] = [];
  const seenText = new Set<string>();
  const $root = $(root as unknown as cheerio.Cheerio<never>);

  const RELATED_FILTER =
    "[class*='related'],[class*='also-read'],[class*='read-also'],[class*='trending'],[class*='recommended'],aside,figure,figcaption,footer,nav";
  const STORY_BODY_SELECTOR =
    "[class*='storybody'],[class*='story-content'],[class*='story_content'],[class*='article-body'],[class*='article_body']";

  function consider($el: cheerio.Cheerio<never>) {
    if ($el.closest(RELATED_FILTER).length) return;
    const text = $el.text().replace(/\s+/g, " ").trim();
    if (text.length < 3) return;
    if (seenText.has(text)) return;
    seenText.add(text);
    rawParas.push({ text, wordCount: wordCount(text) });
  }

  // Pass 1 — paragraphs inside the chosen root.
  $root.find("p").each((_, el) => {
    consider($(el) as unknown as cheerio.Cheerio<never>);
  });

  // Pass 2 — paragraphs inside story-body containers anywhere on the
  // page, in case the root selector picked a too-narrow container
  // and missed siblings. Same junk-filter applies.
  $(STORY_BODY_SELECTOR)
    .find("p")
    .each((_, el) => {
      consider($(el) as unknown as cheerio.Cheerio<never>);
    });

  const h2Headings: string[] = [];
  $root.find("h2").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t) h2Headings.push(t);
  });

  const headingSequence: string[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (tag) headingSequence.push(tag);
  });

  const images: ArticleImage[] = [];
  // Prefer og:image as feature image when present
  if (ogImage) {
    images.push({
      src: ogImage,
      alt: $("meta[property='og:image:alt']").attr("content") ?? "",
      filename: basename(ogImage),
      width: intOrUndef($("meta[property='og:image:width']").attr("content")),
      height: intOrUndef($("meta[property='og:image:height']").attr("content")),
      isFeature: true,
    });
  }
  let nonSystemIdx = 0;
  let mixedContentImageCount = 0;
  // Containers that hold thumbnails for OTHER articles (related stories,
  // "यह भी पढ़ें") or site chrome (header, footer, aside, social-share bars).
  // Kept tight on purpose — patterns like 'widget' or 'sidebar' falsely match
  // Patrika's CSS-module layout helpers (e.g. `two-column-layout_center_widget_container__…`)
  // and would skip the actual article body image.
  const NON_BODY_CTX_SELECTOR =
    "[class*='related'],[class*='also-read'],[class*='read-also']," +
    "[class*='social-share'],[class*='share-button']," +
    "aside,footer,nav,header";

  $root.find("img").each((_, el) => {
    const $img = $(el);
    if ($img.closest(NON_BODY_CTX_SELECTOR).length) return;
    const rawSrc = $img.attr("src") || $img.attr("data-src") || "";
    if (!rawSrc) return;
    const filename = basename(rawSrc);
    const declaredWidthAttr = $img.attr("width");
    const widthAttr = intOrUndef(declaredWidthAttr);
    if (isSystemImage(filename, rawSrc, widthAttr, declaredWidthAttr))
      return;
    let absoluteSrc = rawSrc;
    try {
      absoluteSrc = new URL(rawSrc, url).toString();
    } catch {
      // keep raw src
    }
    const alt = ($img.attr("alt") ?? "").trim();
    const width = widthAttr;
    const height = intOrUndef($img.attr("height"));
    const caption = $img
      .closest("figure")
      .find("figcaption")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const loading = $img.attr("loading")?.trim();
    const isHttp = absoluteSrc.startsWith("http://");
    if (pageProtocol === "https" && isHttp) mixedContentImageCount += 1;
    images.push({
      src: absoluteSrc,
      alt,
      filename,
      width,
      height,
      caption: caption || undefined,
      isFeature: !ogImage && nonSystemIdx === 0,
      loading: loading || undefined,
      isHttp,
    });
    nonSystemIdx += 1;
  });

  // Dedupe by filename — the og:image is often the same file as the inline
  // body image but with no alt text. Keep one entry per filename and merge
  // the richer fields.
  const dedup = new Map<string, ArticleImage>();
  for (const img of images) {
    const key = img.filename.toLowerCase();
    const prev = dedup.get(key);
    if (!prev) {
      dedup.set(key, img);
      continue;
    }
    const prefer = (img.alt?.length ?? 0) > (prev.alt?.length ?? 0) ? img : prev;
    const other = prefer === img ? prev : img;
    dedup.set(key, {
      ...prefer,
      width: prefer.width ?? other.width,
      height: prefer.height ?? other.height,
      caption: prefer.caption ?? other.caption,
      isFeature: prev.isFeature || img.isFeature,
      loading: prefer.loading ?? other.loading,
    });
  }
  const dedupedImages = [...dedup.values()];
  images.length = 0;
  images.push(...dedupedImages);

  const embeds: ArticleEmbed[] = [];
  let paragraphIdx = 0;
  let lastH2Before = false;
  $root.find("p, h2, h3, iframe, blockquote.twitter-tweet").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    if (tag === "p") {
      paragraphIdx += 1;
      lastH2Before = false;
    } else if (tag === "h2" || tag === "h3") {
      lastH2Before = true;
    } else if (tag === "iframe") {
      const $el = $(el);
      const src = $el.attr("src") || "";
      const isVideo = /youtube|youtu\.be|vimeo|dailymotion|facebook\.com\/.*video|jwplayer/i.test(src);
      embeds.push({
        kind: isVideo ? "video" : "iframe",
        positionAfterParagraph: paragraphIdx,
        hasSubheadBefore: lastH2Before,
        src,
      });
    } else if (tag === "blockquote") {
      embeds.push({
        kind: "tweet",
        positionAfterParagraph: paragraphIdx,
        hasSubheadBefore: lastH2Before,
      });
    }
  });

  let internalLinkCount = 0;
  let externalLinkCount = 0;
  let hasReadAlso = false;
  let unsafeExternalLinkCount = 0;
  const weakAnchors: AnchorIssue[] = [];
  const readAlsoMarkers = [
    "यह भी पढ़ें",
    "ये भी पढ़ें",
    "Read Also",
    "Also Read",
    "इसे भी पढ़ें",
  ];
  const VAGUE_ANCHOR_RE =
    /^(click here|read more|here|यहाँ\s+क्लिक|यहां\s+क्लिक|यहाँ|यहां|और\s+पढ़ें|देखें|click|more)\.?$/i;

  // Social-share / utility containers we should NOT count as content anchors.
  const NON_CONTENT_ANCHOR_SCOPE =
    "nav,aside,footer,header," +
    "[class*='social-share'],[class*='share-button']," +
    "[class*='socialshare'],[class*='shareButtons']," +
    "[class*='share_'],[class*='_share'],[class*='share-icons']";

  $root.find("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    const isInUtilityScope =
      $el.closest(NON_CONTENT_ANCHOR_SCOPE).length > 0;
    let isExternal = false;
    try {
      const target = new URL(href, url);
      const isInternal = target.hostname.endsWith("patrika.com");
      if (isInternal) internalLinkCount += 1;
      else {
        externalLinkCount += 1;
        isExternal = true;
      }
    } catch {
      // ignore
    }
    const txt = ($el.text() || "").replace(/\s+/g, " ").trim();
    if (readAlsoMarkers.some((m) => txt.includes(m))) hasReadAlso = true;

    // Anchor-text quality check — only against real content anchors. Skip
    // anchors inside nav/aside/footer/social-share scopes, anchors with an
    // accessible label (aria-label / title), and icon-only anchors that
    // contain <svg>, <img>, <i class="icon-…">, or <picture>.
    const ariaLabel = $el.attr("aria-label")?.trim();
    const titleAttr = $el.attr("title")?.trim();
    const hasIconChild =
      $el.find("svg, img, picture, [class*='icon']").length > 0;
    const hasAccessibleLabel = !!(ariaLabel || titleAttr);

    if (
      !isInUtilityScope &&
      !hasAccessibleLabel &&
      weakAnchors.length < 8
    ) {
      if (txt) {
        if (VAGUE_ANCHOR_RE.test(txt)) {
          weakAnchors.push({ href, text: txt, reason: "vague" });
        } else if (txt === href) {
          weakAnchors.push({ href, text: txt, reason: "url-as-text" });
        }
      } else if (!hasIconChild) {
        // Truly empty anchor: no text, no aria-label, no icon. Real bug.
        weakAnchors.push({ href, text: "(empty link)", reason: "empty" });
      }
    }

    // External link safety: only count links inside the article body.
    if (
      !isInUtilityScope &&
      isExternal &&
      /\b_blank\b/i.test($el.attr("target") ?? "")
    ) {
      const rel = ($el.attr("rel") ?? "").toLowerCase();
      if (!/\bnoopener\b/.test(rel) && !/\bnoreferrer\b/.test(rel)) {
        unsafeExternalLinkCount += 1;
      }
    }
  });
  if (!hasReadAlso) {
    const fullText = $root.text();
    hasReadAlso = readAlsoMarkers.some((m) => fullText.includes(m));
  }

  const bodyText = rawParas.map((p) => p.text).join("\n\n");
  const bodyHtml = ($root.html() || "").slice(0, 200000);

  let category: string | undefined;
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (seg) category = seg;
  } catch {
    // ignore
  }

  return {
    url,
    fetchedAt,
    ok: true,
    title,
    metaTitle,
    metaDescription,
    ogTitle,
    ogDescription,
    ogImage,
    twitterCard,
    twitterImage,
    canonical,
    category,
    author: author || undefined,
    authorLink: authorLink || undefined,
    publishedAt: publishedAt || undefined,
    modifiedAt: modifiedAt || undefined,
    language,
    hreflangs,
    robotsMeta,
    hasMaxImagePreviewLarge,
    bodyText,
    bodyHtml,
    paragraphs: rawParas,
    h1Count,
    h2Count: h2Headings.length,
    h2Headings,
    headingSequence,
    images,
    embeds,
    internalLinkCount,
    externalLinkCount,
    hasReadAlso,
    wordCount: wordCount(bodyText),
    structuredData,
    viewport,
    charset,
    weakAnchors,
    mixedContentImageCount,
    unsafeExternalLinkCount,
    pageProtocol,
  };
}

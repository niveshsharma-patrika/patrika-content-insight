export type SitemapEntry = {
  url: string;
  publishedAt: string;
  title: string;
  language: string;
  keywords?: string;
  genres?: string;
};

export type Paragraph = {
  text: string;
  wordCount: number;
};

export type ArticleImage = {
  src: string;
  alt: string;
  filename: string;
  width?: number;
  height?: number;
  caption?: string;
  isFeature: boolean;
  loading?: "lazy" | "eager" | string;
  isHttp?: boolean;
};

export type AnchorIssue = {
  href: string;
  text: string;
  reason: "vague" | "empty" | "url-as-text";
};

export type ArticleEmbed = {
  kind: "video" | "tweet" | "iframe";
  positionAfterParagraph: number;
  hasSubheadBefore: boolean;
  src?: string;
};

// Gemini AI slug analysis result. Lives in types.ts so the rules engine can
// reference it without importing the Gemini client (which depends on Node fs).
export type SlugVerdict = {
  slug: string;
  verdict: "clear" | "hinglish" | "gibberish";
  score: number; // 0–100, readability
  language: "english" | "hinglish" | "mixed" | "unknown";
  notes: string;
};

export type StructuredData = {
  hasNewsArticle: boolean;
  hasArticle: boolean;
  hasBreadcrumb: boolean;
  schemaType?: string;
  headline?: string;
  datePublished?: string;
  dateModified?: string;
  authorType?: string;
  authorName?: string;
  authorUrl?: string;
  publisherName?: string;
  publisherLogo?: string;
  imageInSchema?: string;
  /**
   * Publisher-curated full body text from JSON-LD `articleBody`.
   * Preferred over DOM-scraped bodyText when present because Patrika's
   * live-blog layout splits entries across separate <h2> subheads + <p>
   * bodies — our DOM walk only collects <p> and undercounts the article
   * by ~30 words per live-blog page. JSON-LD is single-flow and accurate.
   */
  articleBody?: string;
  raw?: string;
};

export type ScrapedArticle = {
  url: string;
  fetchedAt: string;
  ok: boolean;
  error?: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  twitterCard?: string;
  twitterImage?: string;
  canonical?: string;
  category?: string;
  author?: string;
  authorLink?: string;
  publishedAt?: string;
  modifiedAt?: string;
  language?: string;
  hreflangs: string[];
  robotsMeta?: string;
  hasMaxImagePreviewLarge: boolean;
  bodyText: string;
  bodyHtml: string;
  paragraphs: Paragraph[];
  h1Count: number;
  h2Count: number;
  h2Headings: string[];
  headingSequence: string[];
  images: ArticleImage[];
  embeds: ArticleEmbed[];
  internalLinkCount: number;
  externalLinkCount: number;
  hasReadAlso: boolean;
  wordCount: number;
  structuredData: StructuredData;
  viewport?: string;
  charset?: string;
  weakAnchors: AnchorIssue[];
  mixedContentImageCount: number;
  unsafeExternalLinkCount: number;
  pageProtocol?: "http" | "https";
  // Gemini-evaluated slug verdict — populated in analyzeOne when a cached
  // verdict exists for this URL. Rules can read it; absence means "not run".
  slugVerdict?: SlugVerdict;

  // ---- HTTP-level perf signals (captured during fetch). Used by the
  // SEO-track rules so we can flag redirects, missing compression /
  // cache headers, and slow TTFB without needing a real browser.
  /** ms from `fetch()` call to the resolved Response object (server-to-server TTFB-ish). */
  ttfbMs?: number;
  /** Final URL after any redirects — `res.url`. May differ from the requested URL. */
  finalUrl?: string;
  /** `res.redirected`. True if at least one redirect happened. */
  redirected?: boolean;
  /** Value of the `content-encoding` response header (e.g. "br", "gzip"). */
  contentEncoding?: string;
  /** Value of the `cache-control` response header. */
  cacheControl?: string;
  /** Byte length of the raw HTML body. */
  htmlBytes?: number;

  // ---- <head>-derived perf signals. Heuristic, not a Lighthouse
  // replacement — but enough to surface "you forgot async on a
  // 200kB analytics script" patterns.
  /** Synchronous <script> tags inside <head> (no async/defer). */
  renderBlockingScripts?: number;
  /** <link rel="stylesheet"> in <head> without media="print"-style scoping. */
  renderBlockingStyles?: number;
  /** <link rel="preload" as="font"> count in <head>. */
  fontPreloadCount?: number;
  /** Any linked CSS or inline style contains `font-display: swap`. */
  hasFontDisplaySwap?: boolean;
  /** <script src=...> whose host isn't patrika.com. */
  thirdPartyScriptCount?: number;
  /** Value of <link rel="amphtml" href="..."> if present. */
  ampUrl?: string;
  /** Result of fetching + analyzing the AMP version, when ampUrl exists. */
  amp?: AmpReport;
};

/**
 * Analysis of an article's AMP (Accelerated Mobile Pages) version,
 * fetched separately from `ampUrl`. Drives the `amp` category rules:
 * structural validation, AMP↔canonical content parity, schema parity,
 * and embed preservation. `fetched=false` means we couldn't retrieve
 * the AMP page (network/no ampUrl) — rules treat that as "not checked".
 */
export type AmpReport = {
  /** The amphtml URL we fetched. */
  url: string;
  fetched: boolean;
  error?: string;
  /** No structural/critical AMP errors found (heuristic validator). */
  valid: boolean;
  /** Human-readable critical issues; empty when valid. */
  criticalErrors: string[];
  /** Body word count on the AMP page (for content-parity check). */
  wordCount: number;
  hasNewsArticle: boolean;
  schemaType?: string;
  schemaHeadline?: string;
  schemaDatePublished?: string;
  /** Count of amp-* media/social embeds (amp-youtube, amp-twitter, …). */
  embedCount: number;
};

export type Severity = "error" | "warning" | "info";

export type RuleScope = "editorial" | "seo";

export type RuleCategory =
  | "url"
  | "headline"
  | "meta"
  | "intro"
  | "body"
  | "image"
  | "embed"
  | "seo"
  | "schema"
  | "eeat"
  | "discover"
  | "amp";

export type RuleResult = {
  passed: boolean;
  message?: string;
  detail?: string;
};

export type Rule = {
  id: string;
  category: RuleCategory;
  scope: RuleScope;
  title: string;
  severity: Severity;
  description: string;
  reference?: string;
  check: (article: ScrapedArticle, sitemap: SitemapEntry) => RuleResult;
};

export type ArticleAnalysis = {
  sitemap: SitemapEntry;
  article: ScrapedArticle;
  results: Array<{
    rule: Pick<
      Rule,
      "id" | "category" | "scope" | "title" | "severity" | "description" | "reference"
    >;
    result: RuleResult;
  }>;
  errorCount: number;
  warningCount: number;
  passCount: number;
  totalRules: number;
  score: number;
  editorialScore: number;
  seoScore: number;
  topIssue?: {
    ruleId: string;
    title: string;
    severity: Severity;
    message?: string;
  };
  /** True if the cron has scraped this URL more than once — Patrika
   *  bumped its publish-time, indicating an edit / re-publish. */
  isUpdated?: boolean;
};

/**
 * Compact, client-shippable projection of an ArticleAnalysis. The
 * dashboard loads a WHOLE DAY of these at once so hour-switching and
 * filtering (author / section / status / rule) happen instantly in the
 * browser with no server round-trip. Carries only the fields the grid
 * cards and the client filter pipeline need — crucially the FAILED
 * rules only (a handful per article) instead of all 73 results, so a
 * 300-article day stays a few hundred KB, not several MB.
 */
export type ArticleLite = {
  url: string;
  /** URL pathname, precomputed for display. */
  path: string;
  /** Section slug (first path segment), precomputed. */
  category: string;
  title: string;
  publishedAt: string;
  /** IST clock-hour 0–23, precomputed for the hour strip + filter. */
  hour: number;
  ok: boolean;
  author: string | null;
  isUpdated: boolean;
  score: number;
  editorialScore: number;
  seoScore: number;
  errorCount: number;
  warningCount: number;
  topIssue?: ArticleAnalysis["topIssue"];
  /** Only the rules this article FAILS — drives the status/scope filter,
   *  the rule-click filter, and the card's "failing rule" line. */
  fails: Array<{
    ruleId: string;
    scope: RuleScope;
    severity: Severity;
    message?: string;
  }>;
  /** Cached Gemini slug verdict, if any. */
  slug?: {
    verdict: "clear" | "hinglish" | "gibberish";
    score: number;
    notes?: string;
  };
  /** Author resolved to an app_users row, if matched. */
  matchedUser?: {
    id: string;
    name: string;
    telegramChatId: string | null;
  } | null;
};

export type DashboardSummary = {
  generatedAt: string;
  totalArticles: number;
  analyzed: number;
  failedToFetch: number;
  errors: number;
  warnings: number;
  passes: number;
  averageScore: number;
  averageEditorialScore: number;
  averageSeoScore: number;
  topViolations: Array<{
    ruleId: string;
    title: string;
    category: RuleCategory;
    scope: RuleScope;
    severity: Severity;
    count: number;
  }>;
  byCategory: Record<RuleCategory, { errors: number; warnings: number }>;
  articles: ArticleAnalysis[];
};

// AI analysis types
export type AIArticleAnalysis = {
  generatedAt: string;
  model: string;
  copyQualityScore: number;
  headlineJustified: boolean;
  headlineCommentary: string;
  originalityScore: number;
  originalityCommentary: string;
  translationSuspicion: "none" | "low" | "medium" | "high";
  translationCommentary?: string;
  redFlags: string[];
  suggestions: string[];
  overallVerdict: string;
};

export type AIImageAnalysis = {
  generatedAt: string;
  model: string;
  imageUrl: string;
  qualityScore: number;
  relevanceScore: number;
  composition: string;
  issues: string[];
  isStockOrFile: boolean;
  recommendation: string;
};

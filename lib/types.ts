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
  | "discover";

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

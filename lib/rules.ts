import type { Rule, RuleResult, ScrapedArticle, SitemapEntry } from "./types";

const FILLER_WORDS = [
  "is", "am", "are", "of", "the", "a", "an", "to", "in",
  "on", "at", "for", "with", "by", "and", "or", "but",
  "which", "who", "where", "what", "when", "why", "how",
  "this", "that", "these", "those", "be", "been",
];

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const JUNK_URL_RE = /[%#?&]/;

const CLICKBAIT_PATTERNS = [
  /you\s+won['’]?t\s+believe/i,
  /shocking/i,
  /unbelievable/i,
  /जरूर\s+देख/,
  /वायरल/,
  /हैरान/,
  /चौंका/,
  /!{2,}/,
  /\?{2,}/,
];

function ok(): RuleResult {
  return { passed: true };
}
function fail(message: string, detail?: string): RuleResult {
  return { passed: false, message, detail };
}

function urlSlug(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function slugWords(slug: string): string[] {
  return slug
    .toLowerCase()
    .replace(/\.html?$/i, "")
    .split(/[/\-_]+/)
    .filter(Boolean);
}

function normalize(s: string): string {
  // Lowercase, replace anything that isn't a letter, COMBINING MARK, digit,
  // or whitespace with a space. Preserving \p{M} is critical for Devanagari —
  // without it, vowel signs (ा ि े ं ्) split every Hindi word apart.
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function jaccard(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalize(a);
  const nb = normalize(b);
  // Fast path: if one string is contained in the other, treat as fully aligned.
  if (na.length >= 8 && (nb.includes(na) || na.includes(nb))) return 1;
  const tok = (s: string) =>
    new Set(s.split(" ").filter((w) => w.length > 2));
  const A = tok(na);
  const B = tok(nb);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

// State / abbr tokens that show up legitimately in Patrika URLs even though
// they have no vowels.
const SHORT_VALID_TOKENS = new Set([
  "mp", "up", "rj", "wb", "tn", "ts", "ap", "ka", "kl", "mh", "od", "br",
  "jk", "hp", "ch", "dl", "py", "ga", "as",
  "bjp", "cm", "pm", "ai", "id", "tv", "fm", "pdf", "iit", "iim", "upi",
  "rbi", "sebi", "sc", "hc", "lr", "fir", "cbi", "ed", "ipl", "icc", "fifa",
  "lic", "irctc", "nse", "bse", "sbi", "hdfc", "rjd",
]);

// Hinglish vowel-pattern check. Real words (English or Devanagari-in-Latin)
// contain vowels. Random/abbreviated tokens don't or have long consonant runs.
function looksLikeAWord(w: string): boolean {
  const lower = w.toLowerCase();
  if (SHORT_VALID_TOKENS.has(lower)) return true;
  if (/^\d+$/.test(lower)) return false;
  if (lower.length < 3) return false;
  // Contains at least one vowel (English or transliterated Hindi)
  if (!/[aeiouy]/i.test(lower)) return false;
  // Five-or-more consonants in a row → likely a random ID or compressed abbr
  if (/[bcdfghjklmnpqrstvwxz]{5,}/i.test(lower)) return false;
  // Mostly digits with a vowel hidden → not a word
  const digits = lower.replace(/[^0-9]/g, "").length;
  if (digits / lower.length > 0.5) return false;
  return true;
}

const REF_DISCOVER_2026 =
  "Google Discover Core Update — Feb 2026: rewards original reporting and high-quality images ≥1200px; penalizes clickbait.";
const REF_CORE_2026 =
  "Google Core Update — March 2026: tightened E-E-A-T scoring; emphasis on author credibility and topic authority.";
const REF_NEWSARTICLE =
  "Google Search Central — NewsArticle structured data requires headline, image, datePublished, author (Person), publisher with logo. JSON-LD must be in raw HTML.";

export const rules: Rule[] = [
  // ---------- URL ----------
  {
    id: "url-no-devanagari",
    category: "url",
    scope: "editorial",
    title: "URL must not contain Hindi/Devanagari characters",
    severity: "error",
    description:
      "URL में एक भी Hindi/Devanagari character नहीं होना चाहिए। SEO और sharing के लिए ASCII slug ज़रूरी है।",
    check: (a) => {
      const slug = urlSlug(a.url);
      if (DEVANAGARI_RE.test(decodeURIComponent(slug)))
        return fail("URL contains Devanagari characters", slug);
      return ok();
    },
  },
  {
    id: "url-no-junk-chars",
    category: "url",
    scope: "editorial",
    title: "URL must not contain junk characters (%, #, ?, &)",
    severity: "error",
    description: "URL में %, #, ?, & जैसे junk characters नहीं होने चाहिए।",
    check: (a) => {
      const slug = urlSlug(a.url);
      if (JUNK_URL_RE.test(slug))
        return fail("URL contains junk characters", slug);
      return ok();
    },
  },
  {
    id: "url-no-filler-words",
    category: "url",
    scope: "editorial",
    title: "URL should not contain filler words",
    severity: "warning",
    description:
      "is, am, are, of, which, who, where जैसे filler words URL में नहीं होने चाहिए।",
    check: (a) => {
      const words = slugWords(urlSlug(a.url));
      const found = words.filter((w) => FILLER_WORDS.includes(w));
      if (found.length)
        return fail(
          `URL contains filler words: ${[...new Set(found)].join(", ")}`,
        );
      return ok();
    },
  },
  {
    id: "url-no-repeated-words",
    category: "url",
    scope: "editorial",
    title: "URL should not repeat words",
    severity: "warning",
    description: "URL में कोई word unnecessarily repeat नहीं होना चाहिए।",
    check: (a) => {
      const words = slugWords(urlSlug(a.url)).filter((w) => w.length > 2);
      const counts = new Map<string, number>();
      for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
      const dups = [...counts.entries()].filter(([, c]) => c > 1).map(([w]) => w);
      if (dups.length)
        return fail(`URL repeats words: ${dups.join(", ")}`);
      return ok();
    },
  },
  {
    id: "url-length",
    category: "url",
    scope: "seo",
    title: "URL slug should be reasonably short",
    severity: "info",
    description: "Short, keyword-focused URLs rank and share better.",
    check: (a) => {
      const slug = urlSlug(a.url);
      const last = slug.split("/").filter(Boolean).pop() ?? "";
      if (last.length > 90)
        return fail(`URL slug is ${last.length} chars (>90)`, last);
      return ok();
    },
  },
  {
    id: "url-slug-english-only",
    category: "url",
    scope: "editorial",
    title: "URL slug must be proper English (not Hinglish or Hindi)",
    severity: "warning",
    description:
      "AI-evaluated by Gemini. Patrika.com style requires URL slugs to be proper English — Hinglish (transliterated Hindi like 'vyavstha', 'sankalp', 'paramparik') and Devanagari are not allowed. Proper nouns (Udaipur, Modi, Rajasthan) are accepted English usage.",
    reference:
      "Patrika.com URL style + Google SEO Starter Guide — Use simple, descriptive URLs.",
    check: (a) => {
      const slug = (urlSlug(a.url).split("/").filter(Boolean).pop() ?? "")
        .replace(/-?\d{5,}$/, "")
        .replace(/\.html?$/i, "");

      // Hard fail: any Devanagari character in the URL is unambiguous Hindi.
      if (DEVANAGARI_RE.test(decodeURIComponent(urlSlug(a.url)))) {
        return fail("URL contains Devanagari characters — must be English", slug);
      }

      const v = a.slugVerdict;
      if (!v) {
        // No AI verdict yet. Don't penalize — surface a hint instead.
        return {
          passed: true,
          message: undefined,
          detail:
            "AI verdict not yet generated for this slug. Run 'AI slug check' in Settings to evaluate all slugs at once.",
        };
      }

      if (v.language === "english" && v.verdict === "clear") return ok();

      const reasons: string[] = [];
      if (v.verdict === "gibberish")
        reasons.push("Gemini classified the slug as gibberish.");
      if (v.language === "hinglish" || v.verdict === "hinglish")
        reasons.push("Gemini detected Hinglish (transliterated Hindi).");
      if (v.language === "mixed")
        reasons.push("Gemini detected a Hinglish/English mix.");
      if (v.language === "unknown" && v.verdict !== "clear")
        reasons.push("Gemini could not determine a clean English reading.");

      const detail = [
        `Slug: ${v.slug}`,
        `Verdict: ${v.verdict}`,
        `Language: ${v.language}`,
        `Score: ${v.score}/100`,
        v.notes ? `Note: ${v.notes}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return fail(
        reasons.length > 0
          ? reasons.join(" ")
          : `Slug language is '${v.language}' (need 'english')`,
        detail,
      );
    },
  },
  {
    id: "url-slug-meaningful-words",
    category: "url",
    scope: "seo",
    title: "URL slug must read as English / Hinglish words",
    severity: "warning",
    description:
      "Slug words should be readable English or Hinglish (Hindi in Latin script) — not random letters, all-consonant abbreviations, or numeric dumps. Google and humans both use the slug to predict the page's topic.",
    reference:
      "Google SEO Starter Guide — Use simple, descriptive URLs / Search Central URL structure best practices.",
    check: (a) => {
      const slug = urlSlug(a.url);
      // Last segment, with the trailing CMS id (e.g. -20560385) and .html stripped
      const last = (slug.split("/").filter(Boolean).pop() ?? "")
        .replace(/-?\d{5,}$/, "")
        .replace(/\.html?$/i, "");
      if (!last) return fail("URL slug is empty after stripping the id");

      const words = last.split(/[-_]+/).filter(Boolean);
      const countable = words.filter(
        (w) => w.length >= 3 && !/^\d+$/.test(w),
      );
      if (countable.length < 2)
        return fail(
          `Slug has only ${countable.length} descriptive word(s)`,
          `Slug: ${last}`,
        );

      const meaningful = countable.filter((w) => looksLikeAWord(w));
      const unclear = countable.filter((w) => !looksLikeAWord(w));
      const ratio = meaningful.length / countable.length;
      if (ratio < 0.6)
        return fail(
          `Only ${Math.round(ratio * 100)}% of slug words look like English/Hinglish (${meaningful.length}/${countable.length})`,
          `Slug: ${last}\nUnclear words: ${unclear.join(", ") || "(none)"}`,
        );
      return ok();
    },
  },

  // ---------- Headline ----------
  {
    id: "headline-present",
    category: "headline",
    scope: "editorial",
    title: "Headline / H1 must be present",
    severity: "error",
    description: "Story में H1 headline होनी चाहिए।",
    check: (a) => {
      const len = a.title?.length ?? 0;
      if (!a.title || len < 5)
        return fail(
          `Headline missing or too short (${len} chars)`,
          a.title || "(no <h1> found)",
        );
      return ok();
    },
  },
  {
    id: "headline-single-h1",
    category: "headline",
    scope: "seo",
    title: "Article should have exactly one H1",
    severity: "warning",
    description:
      "Multiple H1 tags confuse Google's content-structure parser and dilute topical focus.",
    check: (a) => {
      if (a.h1Count === 0)
        return fail("No <h1> tag found anywhere on the page");
      if (a.h1Count > 1)
        return fail(
          `Page has ${a.h1Count} <h1> tags — should be exactly 1`,
        );
      return ok();
    },
  },
  {
    id: "headline-length",
    category: "headline",
    scope: "editorial",
    title: "Headline should be crisp (under 120 chars)",
    severity: "warning",
    description: "Meta H1 short और crisp हो — बहुत लंबी headline नहीं।",
    check: (a) => {
      if (a.title.length > 120)
        return fail(
          `Headline is ${a.title.length} chars (>120)`,
          a.title,
        );
      return ok();
    },
  },
  {
    id: "headline-not-clickbait",
    category: "discover",
    scope: "seo",
    title: "Headline should not look like clickbait",
    severity: "warning",
    description:
      "Discover penalizes sensational/clickbait headlines (Feb 2026 update). Avoid 'You won't believe', heavy emoji, double punctuation.",
    reference: REF_DISCOVER_2026,
    check: (a) => {
      const matches = CLICKBAIT_PATTERNS.filter((re) => re.test(a.title));
      if (matches.length >= 1)
        return fail(
          `Headline matches ${matches.length} clickbait pattern(s)`,
          `${a.title}\n\nMatched: ${matches
            .map((re) => re.source)
            .slice(0, 3)
            .join(" | ")}`,
        );
      return ok();
    },
  },

  // ---------- Meta / Excerpt ----------
  {
    id: "meta-description-present",
    category: "meta",
    scope: "seo",
    title: "Meta description must be filled",
    severity: "error",
    description: "Excerpt / meta description ज़रूर भरें।",
    check: (a) => {
      const len = a.metaDescription?.length ?? 0;
      if (len < 30)
        return fail(
          `Meta description is ${len} chars (need ≥30)`,
          a.metaDescription || "(empty)",
        );
      return ok();
    },
  },
  {
    id: "meta-description-length",
    category: "meta",
    scope: "seo",
    title: "Meta description should be 120–160 chars (SEO snippet)",
    severity: "info",
    description: "Google snippet sweet-spot for desktop is 120–160 chars.",
    check: (a) => {
      const len = a.metaDescription.length;
      if (len < 80) return fail(`Meta description only ${len} chars (<80)`);
      if (len > 220) return fail(`Meta description ${len} chars (>220)`);
      return ok();
    },
  },
  {
    id: "meta-not-copy-of-body",
    category: "meta",
    scope: "editorial",
    title: "Excerpt must not be copy-pasted from body",
    severity: "warning",
    description:
      "Body text और excerpt में same sentence नहीं होना चाहिए।",
    check: (a) => {
      const firstPara = a.paragraphs[0]?.text ?? "";
      if (!a.metaDescription || !firstPara) return ok();
      const sim = jaccard(a.metaDescription, firstPara);
      if (sim > 0.6)
        return fail(
          `Meta description ~${Math.round(sim * 100)}% similar to first paragraph`,
        );
      return ok();
    },
  },

  // ---------- Intro ----------
  {
    id: "intro-word-count",
    category: "intro",
    scope: "editorial",
    title: "Intro paragraph should be 70–100 words",
    severity: "warning",
    description: "पहला paragraph 70 से 100 words के बीच हो।",
    check: (a) => {
      const intro = a.paragraphs.find((p) => p.wordCount > 25) ?? a.paragraphs[0];
      if (!intro) return fail("No intro paragraph found");
      if (intro.wordCount < 50)
        return fail(`Intro is ${intro.wordCount} words (<50)`);
      if (intro.wordCount > 130)
        return fail(`Intro is ${intro.wordCount} words (>130)`);
      return ok();
    },
  },

  // ---------- Body ----------
  {
    id: "body-word-count",
    category: "body",
    scope: "editorial",
    title: "Body word count should be ≥350",
    severity: "error",
    description: "Word count 350-400 words से कम न हो।",
    check: (a) => {
      if (a.wordCount < 350)
        return fail(`Body is only ${a.wordCount} words (<350)`);
      return ok();
    },
  },
  {
    id: "body-paragraph-length",
    category: "body",
    scope: "editorial",
    title: "Paragraphs should average 60–90 words",
    severity: "info",
    description: "हर paragraph 70-75 words के आसपास हो।",
    check: (a) => {
      if (a.paragraphs.length < 2) return ok();
      const long = a.paragraphs.filter((p) => p.wordCount > 130).length;
      if (long >= 2)
        return fail(`${long} paragraphs exceed 130 words`);
      return ok();
    },
  },
  {
    id: "body-has-h2",
    category: "body",
    scope: "seo",
    title: "Body must include H2 subheads",
    severity: "warning",
    description:
      "हर paragraph का subhead H2 format में हो। H2s help GEO/AI Overview parsers extract structured answers.",
    reference: REF_CORE_2026,
    check: (a) => {
      if (a.h2Count < 1)
        return fail(`No H2 subheads found in body (found 0 of recommended ≥2)`);
      return ok();
    },
  },
  {
    id: "body-internal-links",
    category: "body",
    scope: "seo",
    title: "Article should link to at least one related story",
    severity: "info",
    description:
      "At least one internal patrika.com link in the body builds topic clusters and improves crawl reach. Google rewards 3+ for stronger topic-authority signals.",
    reference: REF_CORE_2026,
    check: (a) => {
      if (a.internalLinkCount < 1)
        return fail("No internal patrika.com links in the body");
      return ok();
    },
  },
  {
    id: "body-read-also",
    category: "body",
    scope: "editorial",
    title: "Article should include Read Also / यह भी पढ़ें block",
    severity: "info",
    description:
      "Read Also blocks improve dwell time and topic-authority signals. Required only on the longer features.",
    check: (a) => {
      if (!a.hasReadAlso)
        return fail("No 'यह भी पढ़ें' / Read Also block found");
      return ok();
    },
  },

  // ---------- Image ----------
  {
    id: "image-feature-present",
    category: "image",
    scope: "editorial",
    title: "Article must have at least one image",
    severity: "error",
    description: "Story-relevant feature image ज़रूरी है।",
    check: (a) => {
      if (a.images.length < 1)
        return fail(
          "No article images found (after filtering site chrome / SVG icons)",
        );
      return ok();
    },
  },
  {
    id: "image-feature-min-width",
    category: "image",
    scope: "seo",
    title: "Feature image should be ≥1200px wide (Discover requirement)",
    severity: "error",
    description:
      "Discover boosts CTR by ~45% for images ≥1200px (Feb 2026). Set width attr or og:image:width.",
    reference: REF_DISCOVER_2026,
    check: (a) => {
      const feat = a.images.find((i) => i.isFeature) ?? a.images[0];
      if (!feat) return fail("No feature image to size-check");
      if (typeof feat.width === "number" && feat.width < 1200)
        return fail(`Feature image is ${feat.width}px wide (<1200px)`);
      if (typeof feat.width !== "number")
        return fail(
          "Feature image has no declared width (set og:image:width or width attr)",
        );
      return ok();
    },
  },
  {
    id: "image-max-preview-large",
    category: "image",
    scope: "seo",
    title: "Robots meta should include max-image-preview:large",
    severity: "warning",
    description:
      "Required for full-size Discover/Search image previews. ~45% higher CTR.",
    reference: REF_DISCOVER_2026,
    check: (a) => {
      if (!a.hasMaxImagePreviewLarge)
        return fail(
          "Robots meta missing 'max-image-preview:large'",
          a.robotsMeta
            ? `Current robots: ${a.robotsMeta}`
            : "No <meta name=\"robots\"> tag at all",
        );
      return ok();
    },
  },
  {
    id: "image-alt-text",
    category: "image",
    scope: "editorial",
    title: "Every image must have alt text",
    severity: "error",
    description: "Caption और Alt Text दोनों CMS पर fill किए हों।",
    check: (a) => {
      const missing = a.images.filter((img) => !img.alt || img.alt.length < 3);
      if (missing.length) {
        const list = missing
          .slice(0, 4)
          .map((img) => img.src)
          .join("\n");
        const more =
          missing.length > 4 ? `\n…and ${missing.length - 4} more` : "";
        return fail(
          `${missing.length}/${a.images.length} images missing alt text`,
          `${list}${more}`,
        );
      }
      return ok();
    },
  },
  {
    id: "image-alt-length",
    category: "image",
    scope: "editorial",
    title: "Alt text should be ≤110 chars",
    severity: "warning",
    description: "Alt text 90-100 characters से ज़्यादा नहीं हो।",
    check: (a) => {
      const tooLong = a.images.filter((img) => img.alt && img.alt.length > 110);
      if (tooLong.length) {
        const list = tooLong
          .slice(0, 3)
          .map((img) => `${img.src} (${img.alt.length} chars)`)
          .join("\n");
        return fail(
          `${tooLong.length} images with alt text >110 chars`,
          list,
        );
      }
      return ok();
    },
  },
  {
    id: "image-filename-meaningful",
    category: "image",
    scope: "editorial",
    title: "Image filenames should not be generic",
    severity: "warning",
    description:
      "File name story/personality/event के नाम पर हो — 'image.jpg' या '1.jpg' नहीं।",
    check: (a) => {
      const generic = /^(image|photo|img|pic|untitled|default|file|\d+)(-\d+)?\.(jpe?g|png|webp|gif)$/i;
      const bad = a.images.filter((img) => generic.test(img.filename));
      if (bad.length) {
        const detail = bad
          .slice(0, 3)
          .map((img) => img.src)
          .join("\n");
        return fail(
          `${bad.length} image(s) with generic filenames: ${bad
            .slice(0, 3)
            .map((i) => i.filename)
            .join(", ")}`,
          detail,
        );
      }
      return ok();
    },
  },
  {
    id: "image-dimensions-set",
    category: "image",
    scope: "seo",
    title: "Images should declare width/height (CLS / Core Web Vitals)",
    severity: "info",
    description:
      "Explicit dimensions prevent layout shift — tightened in March 2026 Core Update.",
    reference: REF_CORE_2026,
    check: (a) => {
      const missing = a.images.filter(
        (img) => !img.width || !img.height,
      ).length;
      if (missing > 2)
        return fail(`${missing} images missing width/height attributes`);
      return ok();
    },
  },

  // ---------- Embed ----------
  {
    id: "embed-video-position",
    category: "embed",
    scope: "editorial",
    title: "Video embeds should not appear before paragraph 3",
    severity: "warning",
    description:
      "Video embed तीसरे paragraph से पहले नहीं किया जाना चाहिए।",
    check: (a) => {
      const early = a.embeds.filter(
        (e) => e.kind === "video" && e.positionAfterParagraph < 3,
      );
      if (early.length)
        return fail(
          `Video embed appears after paragraph ${early[0].positionAfterParagraph} (<3)`,
        );
      return ok();
    },
  },
  {
    id: "embed-subhead-before-video",
    category: "embed",
    scope: "editorial",
    title: "Subhead should precede video embed",
    severity: "info",
    description: "Video embed से पहले H2 format में subhead हो।",
    check: (a) => {
      const noHead = a.embeds.filter(
        (e) => e.kind === "video" && !e.hasSubheadBefore,
      );
      if (noHead.length)
        return fail(`${noHead.length} video embed(s) without preceding H2/H3`);
      return ok();
    },
  },

  // ---------- SEO basics ----------
  {
    id: "seo-canonical",
    category: "seo",
    scope: "seo",
    title: "Canonical URL should be set",
    severity: "warning",
    description: "Prevents duplicate-content dilution; required for syndicated news.",
    check: (a) => {
      if (!a.canonical)
        return fail("No <link rel=\"canonical\"> tag found on page");
      return ok();
    },
  },
  {
    id: "seo-canonical-matches-url",
    category: "seo",
    scope: "seo",
    title: "Canonical should match the live URL",
    severity: "info",
    description:
      "Canonical pointing elsewhere is allowed for syndication, but unintended mismatches cause indexing loss.",
    check: (a) => {
      if (!a.canonical) return ok();
      try {
        const live = new URL(a.url);
        const can = new URL(a.canonical, a.url);
        if (live.pathname !== can.pathname)
          return fail(
            `Canonical path differs from live URL`,
            `live=${live.pathname} canonical=${can.pathname}`,
          );
        return ok();
      } catch {
        return fail("Canonical URL is malformed");
      }
    },
  },
  {
    id: "seo-og-tags",
    category: "seo",
    scope: "seo",
    title: "Open Graph title, description, image must be set",
    severity: "warning",
    description: "OG meta drives social CTR and is used by Discover.",
    check: (a) => {
      const missing: string[] = [];
      if (!a.ogTitle) missing.push("og:title");
      if (!a.ogDescription) missing.push("og:description");
      if (!a.ogImage) missing.push("og:image");
      if (missing.length) return fail(`Missing: ${missing.join(", ")}`);
      return ok();
    },
  },
  {
    id: "seo-twitter-card",
    category: "seo",
    scope: "seo",
    title: "Twitter card tags should be set",
    severity: "info",
    description: "summary_large_image preferred for news articles.",
    check: (a) => {
      if (!a.twitterCard)
        return fail("No <meta name=\"twitter:card\"> tag found");
      return ok();
    },
  },
  {
    id: "seo-robots-indexable",
    category: "seo",
    scope: "seo",
    title: "Article must not be set to noindex",
    severity: "error",
    description: "Articles flagged noindex are invisible to Search and Discover.",
    check: (a) => {
      if (/noindex/i.test(a.robotsMeta ?? ""))
        return fail(
          "Robots meta contains 'noindex' — article is hidden from Google",
          a.robotsMeta,
        );
      return ok();
    },
  },
  {
    id: "seo-language-set",
    category: "seo",
    scope: "seo",
    title: "HTML lang attribute should be set",
    severity: "info",
    description: "lang='hi' helps Google segment Hindi vs English content.",
    check: (a) => {
      if (!a.language) return fail("<html lang=\"…\"> attribute is missing");
      return ok();
    },
  },

  // ---------- Schema.org / NewsArticle ----------
  {
    id: "schema-newsarticle-present",
    category: "schema",
    scope: "seo",
    title: "NewsArticle JSON-LD should be present",
    severity: "error",
    description:
      "NewsArticle / Article schema in raw HTML (not JS-injected) is foundational for News and AI Mode citations.",
    reference: REF_NEWSARTICLE,
    check: (a) => {
      if (!a.structuredData.hasArticle)
        return fail(
          "No NewsArticle/Article JSON-LD found in raw HTML",
          a.structuredData.raw
            ? "Other JSON-LD blocks exist, but none with @type Article/NewsArticle/BlogPosting"
            : "No <script type=\"application/ld+json\"> blocks found at all",
        );
      return ok();
    },
  },
  {
    id: "schema-headline",
    category: "schema",
    scope: "seo",
    title: "Schema headline should be present",
    severity: "warning",
    description: "Required by Google for News carousels.",
    reference: REF_NEWSARTICLE,
    check: (a) => {
      if (!a.structuredData.hasArticle) return ok();
      if (!a.structuredData.headline)
        return fail(
          "JSON-LD is missing 'headline' field",
          `Schema type: ${a.structuredData.schemaType ?? "?"}`,
        );
      return ok();
    },
  },
  {
    id: "schema-date-published",
    category: "schema",
    scope: "seo",
    title: "Schema datePublished should be present",
    severity: "error",
    description: "Required for News indexing and freshness ranking.",
    reference: REF_NEWSARTICLE,
    check: (a) => {
      if (!a.structuredData.hasArticle) return ok();
      if (!a.structuredData.datePublished)
        return fail("JSON-LD is missing 'datePublished' field");
      return ok();
    },
  },
  {
    id: "schema-date-modified",
    category: "schema",
    scope: "seo",
    title: "Schema dateModified should be present (freshness signal)",
    severity: "info",
    description:
      "Helps Google distinguish updates from re-publishes; rewards thoughtful evergreen updates (Feb 2026).",
    reference: REF_DISCOVER_2026,
    check: (a) => {
      if (!a.structuredData.hasArticle) return ok();
      if (!a.structuredData.dateModified)
        return fail("JSON-LD is missing 'dateModified' field");
      return ok();
    },
  },
  {
    id: "schema-author-person",
    category: "schema",
    scope: "seo",
    title: "Schema author should be a Person object (E-E-A-T)",
    severity: "warning",
    description:
      "Person author with name supports E-E-A-T scoring. Anonymous or generic-org-only attribution loses ground.",
    reference: REF_CORE_2026,
    check: (a) => {
      if (!a.structuredData.hasArticle) return ok();
      const t = a.structuredData.authorType;
      if (!a.structuredData.authorName)
        return fail("Schema author missing");
      if (t && !/Person/i.test(t))
        return fail(
          `Schema author type is '${t}' — Google prefers Person for E-E-A-T`,
        );
      return ok();
    },
  },
  {
    id: "schema-publisher-logo",
    category: "schema",
    scope: "seo",
    title: "Schema publisher must include a logo URL",
    severity: "warning",
    description:
      "Required for the News carousel image; missing publisher.logo blocks rich-result eligibility.",
    reference: REF_NEWSARTICLE,
    check: (a) => {
      if (!a.structuredData.hasArticle) return ok();
      if (!a.structuredData.publisherLogo)
        return fail("Schema missing publisher.logo.url");
      return ok();
    },
  },

  // ---------- E-E-A-T ----------
  {
    id: "eeat-author-byline",
    category: "eeat",
    scope: "seo",
    title: "Article should display a named author byline",
    severity: "warning",
    description:
      "Anonymous or 'Desk'-only attribution loses ranking ground (March 2026 Core Update). Name a real reporter.",
    reference: REF_CORE_2026,
    check: (a) => {
      const author = (a.author ?? "").trim();
      if (!author) return fail("No author byline detected on the page");
      if (/^(desk|patrika\s+desk|web\s+desk|news\s+desk|admin|staff)$/i.test(author))
        return fail(
          `Generic byline '${author}' — name a real reporter`,
          `Found: ${author}`,
        );
      return ok();
    },
  },
  {
    id: "eeat-author-link",
    category: "eeat",
    scope: "seo",
    title: "Author should link to a profile / bio",
    severity: "info",
    description:
      "Author profile links support verifiable credentials, an E-E-A-T signal.",
    reference: REF_CORE_2026,
    check: (a) => {
      if (!a.authorLink)
        return fail(
          a.author
            ? `Author '${a.author}' is shown but not linked to a profile`
            : "No author byline at all",
        );
      return ok();
    },
  },
  {
    id: "eeat-published-date-visible",
    category: "eeat",
    scope: "seo",
    title: "Article should expose machine-readable published date",
    severity: "warning",
    description:
      "Required for News timeliness; missing dates often cause Discover deboost.",
    reference: REF_DISCOVER_2026,
    check: (a) => {
      // JSON-LD datePublished is also a valid machine-readable date for Google.
      if (!a.publishedAt && !a.structuredData.datePublished)
        return fail(
          "No machine-readable publish date anywhere",
          "Need at least one of: <meta property=\"article:published_time\">, <time datetime=\"…\">, or JSON-LD datePublished",
        );
      return ok();
    },
  },
  {
    id: "eeat-modified-date-visible",
    category: "eeat",
    scope: "seo",
    title: "Updated articles should expose modified date",
    severity: "info",
    description: "Lets Google reward thoughtful updates instead of treating them as re-publishes.",
    reference: REF_DISCOVER_2026,
    check: (a) => {
      if (a.publishedAt && !a.modifiedAt && !a.structuredData.dateModified)
        return fail(
          "Neither article:modified_time meta nor schema dateModified is set",
        );
      return ok();
    },
  },

  // ---------- Discover-specific ----------
  {
    id: "discover-headline-keyword-match",
    category: "discover",
    scope: "seo",
    title: "Headline keywords should appear in intro",
    severity: "info",
    description:
      "Discover demotes headlines that don't deliver on their promise. The intro should pick up the headline's main subject.",
    reference: REF_DISCOVER_2026,
    check: (a) => {
      // Skip very short lead-in paragraphs (date stamps, breadcrumb words, byline).
      const intro =
        a.paragraphs.find((p) => p.wordCount > 25)?.text ?? a.paragraphs[0]?.text ?? "";
      if (!a.title || !intro) return ok();
      const sim = jaccard(a.title, intro);
      if (sim < 0.05)
        return fail(
          `Headline and intro share only ~${Math.round(sim * 100)}% keyword overlap`,
          `Headline: ${a.title}\n\nIntro starts: ${intro.slice(0, 240)}`,
        );
      return ok();
    },
  },

  // ---------- Widely-accepted SEO rules (Lighthouse SEO audit, web.dev, Google Search Central) ----------
  {
    id: "seo-viewport-meta",
    category: "seo",
    scope: "seo",
    title: "Mobile viewport meta tag must be set",
    severity: "error",
    description:
      "Pages without <meta name=\"viewport\"> render at desktop width on mobile and fail Google's mobile-friendly test.",
    reference:
      "Lighthouse SEO audit 'has-viewport-meta-tag' / Google Mobile-Friendly Test.",
    check: (a) => {
      if (!a.viewport)
        return fail("No <meta name=\"viewport\"> tag found in <head>");
      if (!/width\s*=\s*device-width/i.test(a.viewport))
        return fail(
          "Viewport meta does not set width=device-width",
          a.viewport,
        );
      return ok();
    },
  },
  {
    id: "seo-charset-declared",
    category: "seo",
    scope: "seo",
    title: "Page must declare a character encoding",
    severity: "warning",
    description:
      "Without an explicit charset, browsers may render Devanagari / non-ASCII text incorrectly. UTF-8 is required.",
    reference: "W3C HTML standard / Google Search Central technical SEO checklist.",
    check: (a) => {
      if (!a.charset)
        return fail(
          "No <meta charset> tag found",
          "Both <meta charset=\"UTF-8\"> and <meta http-equiv=\"Content-Type\" content=\"…\"> are absent",
        );
      if (!/utf-?8/i.test(a.charset))
        return fail(
          `Charset is '${a.charset}' — Google strongly recommends UTF-8`,
        );
      return ok();
    },
  },
  {
    id: "seo-https",
    category: "seo",
    scope: "seo",
    title: "Page must be served over HTTPS",
    severity: "error",
    description:
      "HTTPS is a confirmed Google ranking signal and a baseline for News.",
    reference: "Google Search Central — HTTPS as a ranking signal.",
    check: (a) => {
      if (a.pageProtocol === "http")
        return fail("Page is served over plain HTTP — must redirect to HTTPS");
      return ok();
    },
  },
  {
    id: "seo-no-mixed-content",
    category: "seo",
    scope: "seo",
    title: "No mixed-content images (http on https page)",
    severity: "warning",
    description:
      "Browsers block http:// images on https:// pages, breaking the visual and the SEO signal.",
    reference:
      "Lighthouse 'is-on-https' / web.dev mixed-content guidelines.",
    check: (a) => {
      if (a.mixedContentImageCount > 0)
        return fail(
          `${a.mixedContentImageCount} image(s) use http:// on an https:// page`,
          a.images
            .filter((i) => i.isHttp)
            .slice(0, 4)
            .map((i) => i.src)
            .join("\n"),
        );
      return ok();
    },
  },
  {
    id: "seo-heading-hierarchy",
    category: "body",
    scope: "seo",
    title: "Heading levels must not skip (no H1 → H3 jumps)",
    severity: "info",
    description:
      "Skipping levels confuses screen readers and Google's content-structure parser.",
    reference: "Lighthouse 'heading-order' / WCAG 1.3.1 Info and Relationships.",
    check: (a) => {
      const seq = a.headingSequence;
      if (seq.length < 2) return ok();
      const skips: string[] = [];
      for (let i = 1; i < seq.length; i++) {
        const prev = parseInt(seq[i - 1].slice(1), 10);
        const cur = parseInt(seq[i].slice(1), 10);
        if (cur - prev > 1) skips.push(`${seq[i - 1]} → ${seq[i]}`);
      }
      if (skips.length)
        return fail(
          `${skips.length} heading-level skip(s) in document`,
          skips.slice(0, 5).join("\n"),
        );
      return ok();
    },
  },
  {
    id: "seo-image-lazy-load",
    category: "image",
    scope: "seo",
    title: "Below-fold images should use loading=\"lazy\"",
    severity: "info",
    description:
      "Lazy-loading inline images defers their fetch and improves LCP / total bytes — Core Web Vitals signal.",
    reference:
      "web.dev/articles/lazy-loading-images / Lighthouse 'efficient-loading'.",
    check: (a) => {
      // The first image is the hero; should NOT be lazy. The rest should.
      const candidates = a.images.filter((i) => !i.isFeature);
      if (candidates.length < 3) return ok();
      const missing = candidates.filter((i) => i.loading !== "lazy");
      if (missing.length / candidates.length > 0.5)
        return fail(
          `${missing.length}/${candidates.length} non-hero images miss loading="lazy"`,
          missing
            .slice(0, 3)
            .map((i) => i.src)
            .join("\n"),
        );
      return ok();
    },
  },
  {
    id: "seo-anchor-descriptive",
    category: "body",
    scope: "seo",
    title: "Anchor text should be descriptive",
    severity: "info",
    description:
      "'Click here' / 'यहाँ क्लिक करें' / bare-URL anchors give Google nothing to relate the link to. Use descriptive anchor text.",
    reference:
      "Google SEO Starter Guide — Write good link text / Lighthouse 'link-text'.",
    check: (a) => {
      if (a.weakAnchors.length === 0) return ok();
      return fail(
        `${a.weakAnchors.length} anchor(s) with weak / vague text`,
        a.weakAnchors
          .slice(0, 5)
          .map((w) => `[${w.reason}] "${w.text}" → ${w.href}`)
          .join("\n"),
      );
    },
  },
  {
    id: "seo-external-link-safety",
    category: "seo",
    scope: "seo",
    title: "External target=\"_blank\" links must use rel=\"noopener\"",
    severity: "warning",
    description:
      "Without rel=\"noopener\", the target page can hijack window.opener — a real security risk and a Lighthouse SEO/best-practice fail.",
    reference: "Lighthouse 'external-anchors-use-rel-noopener' / web.dev.",
    check: (a) => {
      if (a.unsafeExternalLinkCount > 0)
        return fail(
          `${a.unsafeExternalLinkCount} external link(s) open in new tab without rel="noopener"`,
        );
      return ok();
    },
  },
  {
    id: "seo-title-h1-alignment",
    category: "headline",
    scope: "seo",
    title: "<title> should align with the H1",
    severity: "info",
    description:
      "Pages where <title> and <h1> diverge confuse Google about the page's primary subject. Some token overlap is expected.",
    reference: "Google Search Central — Title links best practices.",
    check: (a) => {
      if (!a.title || !a.metaTitle) return ok();
      const sim = jaccard(a.metaTitle, a.title);
      if (sim < 0.15)
        return fail(
          `<title> and <h1> share only ~${Math.round(sim * 100)}% tokens`,
          `<title>: ${a.metaTitle}\n<h1>: ${a.title}`,
        );
      return ok();
    },
  },
  {
    id: "seo-url-lowercase",
    category: "url",
    scope: "seo",
    title: "URL slug should be all lowercase",
    severity: "info",
    description:
      "Mixed-case URLs cause duplicate-content issues and look unprofessional in social shares.",
    reference: "Google SEO Starter Guide — Use simple, descriptive URLs.",
    check: (a) => {
      const slug = urlSlug(a.url);
      if (slug !== slug.toLowerCase())
        return fail(
          "URL contains uppercase characters",
          slug,
        );
      return ok();
    },
  },
  {
    id: "schema-breadcrumb",
    category: "schema",
    scope: "seo",
    title: "BreadcrumbList JSON-LD should be present",
    severity: "info",
    description:
      "BreadcrumbList enables rich-result breadcrumbs in Google Search and improves crawl path understanding.",
    reference:
      "Google Search Central — Breadcrumb structured data.",
    check: (a) => {
      if (!a.structuredData.hasBreadcrumb)
        return fail(
          "No BreadcrumbList JSON-LD found",
          "Add a <script type=\"application/ld+json\"> with @type:BreadcrumbList describing the section path",
        );
      return ok();
    },
  },
];

export function runRules(article: ScrapedArticle, sitemap: SitemapEntry) {
  return rules.map((rule) => ({
    rule: {
      id: rule.id,
      category: rule.category,
      scope: rule.scope,
      title: rule.title,
      severity: rule.severity,
      description: rule.description,
      reference: rule.reference,
    },
    result: rule.check(article, sitemap),
  }));
}

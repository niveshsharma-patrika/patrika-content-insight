import { GoogleGenAI } from "@google/genai";
import { getConfig } from "./config";
import { getDb } from "./db";
import { recordGeminiUsage } from "./geminiUsage";
import type { SlugVerdict } from "./types";

export type { SlugVerdict };

type SlugRow = {
  slug: string;
  verdict: string;
  score: number | null;
  language: string;
  notes: string | null;
};

function rowToVerdict(r: SlugRow): SlugVerdict {
  const v: SlugVerdict["verdict"] =
    r.verdict === "hinglish" || r.verdict === "gibberish"
      ? r.verdict
      : "clear";
  const lang: SlugVerdict["language"] =
    r.language === "english" ||
    r.language === "hinglish" ||
    r.language === "mixed"
      ? r.language
      : "unknown";
  return {
    slug: r.slug,
    verdict: v,
    score: typeof r.score === "number" ? r.score : 0,
    language: lang,
    notes: r.notes ?? "",
  };
}

async function readSlugCacheBatch(
  slugs: string[],
): Promise<Map<string, SlugVerdict>> {
  const out = new Map<string, SlugVerdict>();
  if (slugs.length === 0) return out;
  const db = getDb();
  if (!db) return out;
  const CHUNK = 200;
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const slice = slugs.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("slug_verdicts")
      .select("*")
      .in("slug", slice);
    if (error) continue;
    for (const r of (data ?? []) as SlugRow[]) {
      out.set(r.slug, rowToVerdict(r));
    }
  }
  return out;
}

async function writeSlugVerdicts(verdicts: SlugVerdict[]): Promise<void> {
  if (verdicts.length === 0) return;
  const db = getDb();
  if (!db) return;
  const rows = verdicts.map((v) => ({
    slug: v.slug,
    verdict: v.verdict,
    score: v.score,
    language: v.language,
    notes: v.notes,
    cached_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from("slug_verdicts")
    .upsert(rows, { onConflict: "slug" });
  if (error) {
    console.error("[gemini.writeSlugVerdicts] upsert failed:", error.message);
  }
}

const SYSTEM_PROMPT = `You evaluate URL slugs for Patrika.com. The publisher's standard is that slugs MUST be in proper English. Hinglish (transliterated Hindi in Latin script) is NOT acceptable. Hindi/Devanagari is also not acceptable.

For each slug, return strict JSON:
{"slug": "...", "verdict": "clear"|"hinglish"|"gibberish", "score": 0-100, "language": "english"|"hinglish"|"mixed"|"unknown", "notes": "<1 sentence>"}

Verdict rubric:
- "clear" — every meaningful word is a real English word OR a proper noun (place / person / brand / acronym / event name). Score 80–100.
- "hinglish" — at least one transliterated Hindi common noun, verb, or descriptor (e.g. vyavstha, samvad, ghoshana, paramparik, andolan, sankalp, vidhansabha). Score 30–69. The slug "reads", but it's Hindi in Latin letters, which is the publisher's stated red line.
- "gibberish" — random/abbreviated/meaningless tokens (e.g. jpr-mp-rprt, xyz-abc-qwerty). Score 0–29.

Language tag (independent from verdict):
- "english" — proper-noun-heavy or fully English. Use this even when proper nouns originate in Hindi (Modi, Rajasthan, Udaipur, Shahrukh) — those are accepted English usage.
- "hinglish" — at least one transliterated Hindi common-noun/verb that has a normal English equivalent (use English equivalent: "vyavstha" → "system", "samvad" → "dialogue").
- "mixed" — ambiguous, hard to tell.
- "unknown" — gibberish or empty.

The "notes" field is one short sentence. If verdict is "hinglish", name the offending Hindi word(s) and suggest the English equivalent. Strip trailing CMS IDs from your judgment.

Examples:
- "udaipur-dairy-tanker-rates-are-playing-out" → clear, english (proper nouns + English nouns)
- "cm-mp-mb-bjp-rprt" → gibberish, unknown
- "shaheed-surendra-moga-operation-sindoor-airforce-hero-jhunjhunu" → hinglish, hinglish — "shaheed" is Hindi (use "martyred"); rest is mixed proper nouns + English.
- "jaipur-vidhansabha-vyavstha-naye-niyam" → hinglish, hinglish — vidhansabha/vyavstha/naye/niyam are all transliterated Hindi.
- "modi-cabinet-meeting-decisions" → clear, english.

Words like 'mp', 'up', 'bjp', 'cm', 'pm', 'iit' are legitimate Indian abbreviations and do not by themselves make a slug Hinglish.

Indian-English vocabulary is ACCEPTED English — do not flag these as Hinglish:
- "lakh" (= 100,000) and "crore" (= 10 million): these are standard Indian English number words, used in mainstream Indian media and government communication. Treat them like "million" / "billion".
- "rupee" / "rupees" / "rs": Indian currency, standard English.
- "panchayat", "lok sabha", "rajya sabha", "vidhan sabha", "tehsil", "taluka": only flag these if a clearly more common English equivalent is used by Patrika style. They are widely-accepted Indian-English administrative terms.
Do NOT suggest replacing "lakh" with "hundred thousand" or "crore" with "ten million" — that reads as foreign in Indian context.`;

function extractSlug(url: string): string {
  try {
    const last =
      new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return last.replace(/-?\d{5,}$/, "").replace(/\.html?$/i, "");
  } catch {
    return url;
  }
}

export async function checkSlugsWithGemini(
  urls: string[],
  opts?: { force?: boolean },
): Promise<Record<string, SlugVerdict>> {
  const cfg = await getConfig();
  if (!cfg.geminiApiKey) {
    throw new Error(
      "Gemini API key is not configured. Open Settings to add one.",
    );
  }

  const out: Record<string, SlugVerdict> = {};
  const slugs = urls.map((u) => extractSlug(u)).filter(Boolean);

  const cached = opts?.force
    ? new Map<string, SlugVerdict>()
    : await readSlugCacheBatch(slugs);

  const todo: { url: string; slug: string }[] = [];
  for (const url of urls) {
    const slug = extractSlug(url);
    if (!slug) continue;
    const hit = cached.get(slug);
    if (hit) {
      out[url] = hit;
    } else {
      todo.push({ url, slug });
    }
  }
  if (todo.length === 0) return out;

  const BATCH = 30;
  const ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  const model = cfg.geminiModel || "gemini-2.5-flash";

  const fresh: SlugVerdict[] = [];
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const prompt =
      SYSTEM_PROMPT +
      "\n\nSlugs to evaluate (return JSON array, same order):\n" +
      chunk.map((c, idx) => `${idx + 1}. ${c.slug}`).join("\n");

    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // Best-effort usage accounting — fire and forget. If the SDK shape
    // changes or the DB write fails, we just log and move on; cost
    // tracking is informational, not load-bearing.
    const usage = (response as unknown as {
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    }).usageMetadata;
    if (usage) {
      const promptTokens = usage.promptTokenCount ?? 0;
      const outputTokens = usage.candidatesTokenCount ?? 0;
      try {
        await recordGeminiUsage(promptTokens, outputTokens);
      } catch (e) {
        console.warn(
          "[gemini.checkSlugsWithGemini] usage record failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const text = response.text ?? "";
    const parsed = parseJsonArray(text);
    if (!parsed) continue;

    // Collect this batch's verdicts, then persist before moving on.
    // If a later batch's API call throws (e.g. a 429 mid-stream), we
    // keep what we already learned rather than discarding everything.
    const batchVerdicts: SlugVerdict[] = [];
    for (let j = 0; j < chunk.length; j++) {
      const { url, slug } = chunk[j];
      const raw = parsed[j];
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Record<string, unknown>;
      const verdict: SlugVerdict = {
        slug,
        verdict: normalizeVerdict(item.verdict),
        score: clampScore(item.score),
        language: normalizeLang(item.language),
        notes: typeof item.notes === "string" ? item.notes.trim() : "",
      };
      out[url] = verdict;
      fresh.push(verdict);
      batchVerdicts.push(verdict);
    }

    if (batchVerdicts.length > 0) {
      try {
        await writeSlugVerdicts(batchVerdicts);
      } catch (e) {
        console.warn(
          "[gemini.checkSlugsWithGemini] per-batch persist failed:",
          e instanceof Error ? e.message : String(e),
        );
      }
    }
  }

  return out;
}

function parseJsonArray(text: string): unknown[] | null {
  try {
    const trimmed = text.trim();
    const start = trimmed.indexOf("[");
    const end = trimmed.lastIndexOf("]");
    if (start === -1 || end === -1) return null;
    const arr = JSON.parse(trimmed.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    return arr;
  } catch {
    return null;
  }
}

function normalizeVerdict(v: unknown): SlugVerdict["verdict"] {
  const s = String(v ?? "").toLowerCase();
  if (s === "clear" || s === "hinglish" || s === "gibberish") return s;
  return "clear";
}

function normalizeLang(v: unknown): SlugVerdict["language"] {
  const s = String(v ?? "").toLowerCase();
  if (s === "english" || s === "hinglish" || s === "mixed") return s;
  return "unknown";
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function readCachedSlugVerdicts(
  urls: string[],
): Promise<Record<string, SlugVerdict>> {
  const slugByUrl = new Map<string, string>();
  for (const u of urls) {
    const s = extractSlug(u);
    if (s) slugByUrl.set(u, s);
  }
  const cached = await readSlugCacheBatch([...slugByUrl.values()]);
  const out: Record<string, SlugVerdict> = {};
  for (const [url, slug] of slugByUrl) {
    const hit = cached.get(slug);
    if (hit) out[url] = hit;
  }
  return out;
}

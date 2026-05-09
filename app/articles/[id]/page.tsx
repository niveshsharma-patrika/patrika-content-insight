import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleAnalysisById } from "@/lib/analyze";
import { Badge } from "@/components/Badge";
import { RuleTabs } from "@/components/RuleTabs";
import { SlugAIPanel } from "@/components/SlugAIPanel";
import { NotifyAuthorButton } from "@/components/NotifyAuthorButton";
import { getConfig } from "@/lib/config";
import { readCachedSlugVerdicts } from "@/lib/gemini";
import { findUserForByline } from "@/lib/users";
import { categoryFromUrl, formatRelative } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ArticlePage({ params }: { params: Params }) {
  const { id } = await params;
  const a = await getArticleAnalysisById(id);
  if (!a) notFound();

  const cfg = await getConfig();
  const cachedVerdicts = await readCachedSlugVerdicts([a.sitemap.url]);
  const slugVerdict = cachedVerdicts[a.sitemap.url] ?? null;
  const matchedUser = await findUserForByline(a.article.author);
  const telegramReady = !!cfg.telegramBotToken;

  const editorialResults = a.results.filter(
    (r) => r.rule.scope === "editorial",
  );
  const seoResults = a.results.filter((r) => r.rule.scope === "seo");
  const editorialFails = editorialResults.filter(
    (r) => !r.result.passed,
  ).length;
  const seoFails = seoResults.filter((r) => !r.result.passed).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/" className="hover:text-foreground">
          ← Back to overview
        </Link>
      </div>

      <header className="rounded-xl border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="capitalize">{categoryFromUrl(a.sitemap.url)}</span>
          <span>·</span>
          <span suppressHydrationWarning>
            {formatRelative(a.sitemap.publishedAt)}
          </span>
          {a.article.author ? (
            <>
              <span>·</span>
              <span>by {a.article.author}</span>
            </>
          ) : null}
        </div>
        <h1 className="text-2xl font-semibold leading-snug">
          {a.sitemap.title || a.article.title || "(untitled)"}
        </h1>
        <a
          href={a.sitemap.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-mono text-muted break-all hover:text-accent"
        >
          {a.sitemap.url} ↗
        </a>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3">
          <Stat
            label="Editorial"
            value={a.article.ok ? `${a.editorialScore}%` : "—"}
            hint={`${editorialResults.length - editorialFails}/${editorialResults.length} pass`}
            tone={
              a.editorialScore >= 80 ? "good" : a.editorialScore >= 60 ? "warn" : "bad"
            }
          />
          <Stat
            label="SEO"
            value={a.article.ok ? `${a.seoScore}%` : "—"}
            hint={`${seoResults.length - seoFails}/${seoResults.length} pass`}
            tone={
              a.seoScore >= 80 ? "good" : a.seoScore >= 60 ? "warn" : "bad"
            }
          />
          <Stat
            label="Errors"
            value={a.errorCount}
            tone={a.errorCount ? "bad" : "good"}
          />
          <Stat
            label="Word count"
            value={a.article.wordCount}
            hint={`${a.article.paragraphs.length} paragraphs`}
          />
          <Stat label="Images" value={a.article.images.length} />
        </div>
      </header>

      {!a.article.ok ? (
        <div className="rounded-xl border bg-red-50 p-5 text-sm text-red-800">
          Article fetch failed:{" "}
          <span className="font-mono">{a.article.error}</span>
        </div>
      ) : null}

      {/* Author panel — surface the byline + user mapping + Telegram nudge */}
      <section className="rounded-xl border bg-card p-5 flex flex-wrap items-center gap-4 justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted">
            Byline
          </div>
          {a.article.author ? (
            <div className="mt-0.5 flex items-baseline gap-3 flex-wrap">
              <span className="font-medium">{a.article.author}</span>
              {matchedUser ? (
                <span className="text-xs text-muted">
                  → mapped to{" "}
                  <span className="font-medium text-foreground">
                    {matchedUser.name}
                  </span>
                  {matchedUser.telegramChatId ? (
                    <span className="text-emerald-700 ml-1">
                      · Telegram ready
                    </span>
                  ) : (
                    <span className="text-amber-700 ml-1">
                      · no chat ID set
                    </span>
                  )}
                </span>
              ) : (
                <Link
                  href="/settings#users"
                  className="text-xs text-amber-700 hover:underline"
                >
                  No matching user — map this byline →
                </Link>
              )}
            </div>
          ) : (
            <div className="mt-0.5 text-sm text-muted italic">
              No byline detected on the article.
            </div>
          )}
          {!telegramReady ? (
            <div className="mt-1 text-[11px] text-amber-700">
              Telegram bot token not configured. Set it in{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>
              .
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {a.editorialScore < 80 ? (
            <NotifyAuthorButton
              articleId={id}
              authorName={a.article.author}
              matchedUser={matchedUser}
              editorialScore={a.editorialScore}
              size="lg"
            />
          ) : (
            <span className="text-xs text-emerald-700 px-3 py-1.5">
              Editorial score {a.editorialScore}% — no nudge needed
            </span>
          )}
        </div>
      </section>

      <SlugAIPanel
        hasGeminiKey={!!cfg.geminiApiKey}
        verdict={slugVerdict}
      />

      <RuleTabs
        editorialResults={editorialResults}
        seoResults={seoResults}
        editorialScore={a.editorialScore}
        seoScore={a.seoScore}
      />

      {a.article.ok ? (
        <section className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">SEO snapshot</h3>
            <FieldRow label="Title" value={a.article.title} />
            <FieldRow
              label="Meta description"
              value={a.article.metaDescription}
              multiline
            />
            <FieldRow label="OG title" value={a.article.ogTitle ?? "—"} />
            <FieldRow
              label="OG description"
              value={a.article.ogDescription ?? "—"}
              multiline
            />
            <FieldRow label="OG image" value={a.article.ogImage ?? "—"} />
            <FieldRow label="Twitter card" value={a.article.twitterCard ?? "—"} />
            <FieldRow label="Canonical" value={a.article.canonical ?? "—"} />
            <FieldRow label="Robots" value={a.article.robotsMeta ?? "—"} />
            <FieldRow label="HTML lang" value={a.article.language ?? "—"} />
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-3">
            <h3 className="font-semibold">Schema.org / NewsArticle</h3>
            {a.article.structuredData.hasArticle ? (
              <>
                <FieldRow
                  label="@type"
                  value={a.article.structuredData.schemaType ?? "—"}
                />
                <FieldRow
                  label="headline"
                  value={a.article.structuredData.headline ?? "—"}
                  multiline
                />
                <FieldRow
                  label="datePublished"
                  value={a.article.structuredData.datePublished ?? "—"}
                />
                <FieldRow
                  label="dateModified"
                  value={a.article.structuredData.dateModified ?? "—"}
                />
                <FieldRow
                  label="author"
                  value={`${a.article.structuredData.authorName ?? "—"} (${a.article.structuredData.authorType ?? "?"})`}
                />
                <FieldRow
                  label="publisher"
                  value={a.article.structuredData.publisherName ?? "—"}
                />
                <FieldRow
                  label="publisher.logo"
                  value={a.article.structuredData.publisherLogo ?? "—"}
                />
              </>
            ) : (
              <p className="text-sm text-red-700">
                No NewsArticle / Article JSON-LD detected on the page.
              </p>
            )}
          </div>

          <div className="rounded-xl border bg-card p-5 space-y-3 md:col-span-2">
            <h3 className="font-semibold">Body structure</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <FieldRow
                label="Word count"
                value={`${a.article.wordCount} words / ${a.article.paragraphs.length} paragraphs`}
              />
              <FieldRow
                label="Intro length"
                value={
                  a.article.paragraphs[0]
                    ? `${a.article.paragraphs[0].wordCount} words`
                    : "—"
                }
              />
              <FieldRow
                label="H2 subheads"
                value={String(a.article.h2Count)}
              />
              <FieldRow
                label="Internal links"
                value={String(a.article.internalLinkCount)}
              />
              <FieldRow
                label="External links"
                value={String(a.article.externalLinkCount)}
              />
              <FieldRow
                label="Read Also block"
                value={a.article.hasReadAlso ? "yes" : "no"}
              />
            </div>
            {a.article.h2Count > 0 ? (
              <div className="text-sm">
                <div className="text-xs uppercase text-muted mb-1">
                  H2 list
                </div>
                <ul className="list-disc pl-5 space-y-0.5 text-muted">
                  {a.article.h2Headings.slice(0, 8).map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {a.article.ok && a.article.images.length > 0 ? (
        <section className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold mb-1">
            Images ({a.article.images.length})
          </h3>
          <p className="text-xs text-muted mb-3">
            System images (logo, language switcher, nav SVGs) are filtered out
            of the analysis. Cards highlighted in red are missing alt text.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[...a.article.images]
              .sort((x, y) => {
                const xMissing = !x.alt || x.alt.length < 3 ? 1 : 0;
                const yMissing = !y.alt || y.alt.length < 3 ? 1 : 0;
                return yMissing - xMissing;
              })
              .map((img, i) => {
                const missingAlt = !img.alt || img.alt.length < 3;
                return (
                  <div
                    key={`${img.src}-${i}`}
                    className={`border rounded-lg p-3 text-xs space-y-1 ${
                      missingAlt
                        ? "border-red-300 bg-red-50/40"
                        : "border-stone-200"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono break-all">
                        {img.filename}
                      </span>
                      {img.isFeature ? (
                        <Badge variant="info">feature</Badge>
                      ) : null}
                      {missingAlt ? (
                        <Badge variant="error">missing alt</Badge>
                      ) : null}
                    </div>
                    <a
                      href={img.src}
                      target="_blank"
                      rel="noreferrer"
                      className="block font-mono text-[10px] text-muted hover:text-accent break-all"
                      title="Open image in new tab"
                    >
                      {img.src} ↗
                    </a>
                    <div className="text-muted">
                      {img.width && img.height
                        ? `${img.width}×${img.height}px`
                        : "no size declared"}
                    </div>
                    <div
                      className={
                        missingAlt
                          ? "text-red-700 font-medium"
                          : "text-muted"
                      }
                    >
                      alt:{" "}
                      {img.alt
                        ? `"${img.alt}" (${img.alt.length} chars)`
                        : "— missing —"}
                    </div>
                    {img.caption ? (
                      <div className="text-muted line-clamp-2">
                        caption: {img.caption}
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const tones = {
    neutral: "text-foreground",
    good: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-red-700",
  } as const;
  return (
    <div className="rounded-lg border p-3 bg-stone-50/40">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums mt-0.5 ${tones[tone]}`}>
        {value}
      </div>
      {hint ? <div className="text-[11px] text-muted mt-0.5">{hint}</div> : null}
    </div>
  );
}

function FieldRow({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: React.ReactNode;
  multiline?: boolean;
}) {
  return (
    <div className="text-sm">
      <div className="text-xs uppercase text-muted">{label}</div>
      <div className={multiline ? "mt-0.5 break-words" : "mt-0.5 truncate"}>
        {value}
      </div>
    </div>
  );
}


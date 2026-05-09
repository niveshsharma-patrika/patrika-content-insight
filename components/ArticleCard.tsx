import Link from "next/link";
import { Badge } from "./Badge";
import { NotifyAuthorButton } from "./NotifyAuthorButton";
import type { ArticleAnalysis } from "@/lib/types";
import type { SlugVerdict } from "@/lib/gemini";
import type { User } from "@/lib/users";
import { articleId } from "@/lib/articleId";
import { categoryFromUrl, formatRelative } from "@/lib/utils";

export function ArticleCard({
  a,
  ruleFilterId = null,
  slugVerdict,
  matchedUser = null,
  editorCount = 0,
}: {
  a: ArticleAnalysis;
  ruleFilterId?: string | null;
  slugVerdict?: SlugVerdict;
  matchedUser?: User | null;
  editorCount?: number;
}) {
  const id = articleId(a.sitemap.url);
  const cat = categoryFromUrl(a.sitemap.url);
  const ok = a.article.ok;

  let inlineIssue = a.topIssue?.message ?? a.topIssue?.title;
  let inlineSeverity: "error" | "warning" | "info" | undefined =
    a.topIssue?.severity;
  if (ruleFilterId) {
    const r = a.results.find((x) => x.rule.id === ruleFilterId);
    if (r && !r.result.passed) {
      inlineIssue = r.result.message ?? r.rule.title;
      inlineSeverity = r.rule.severity;
    }
  }

  const path = (() => {
    try {
      return new URL(a.sitemap.url).pathname;
    } catch {
      return a.sitemap.url;
    }
  })();

  return (
    <article className="rounded-xl border bg-card overflow-hidden flex flex-col hover:border-stone-300 transition">
      {/* top strip — meta */}
      <div className="px-4 pt-3.5 pb-2 flex items-center gap-2 text-xs text-muted flex-wrap border-b">
        <span className="capitalize font-medium text-foreground">{cat}</span>
        <span className="text-stone-300">·</span>
        <span suppressHydrationWarning>
          {formatRelative(a.sitemap.publishedAt)}
        </span>
        {a.isUpdated ? (
          <span
            className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            title="Patrika bumped this article's publish-time — re-scraped by the cron"
          >
            Updated
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5">
          {!ok ? (
            <Badge variant="error">fetch failed</Badge>
          ) : a.errorCount > 0 ? (
            <Badge variant="error">{a.errorCount} error{a.errorCount === 1 ? "" : "s"}</Badge>
          ) : a.warningCount > 0 ? (
            <Badge variant="warning">{a.warningCount} warning{a.warningCount === 1 ? "" : "s"}</Badge>
          ) : (
            <Badge variant="pass">clean</Badge>
          )}
        </span>
      </div>

      {/* body */}
      <div className="px-4 py-3 flex-1 flex flex-col gap-2">
        <h3
          className="font-medium text-[15px] leading-snug line-clamp-2"
          title={a.sitemap.title}
        >
          {a.sitemap.title || a.article.title || "(untitled)"}
        </h3>
        <div className="font-mono text-[11px] text-muted truncate" title={path}>
          {path}
        </div>
        {slugVerdict ? (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span
              className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                slugVerdict.verdict === "clear"
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : slugVerdict.verdict === "hinglish"
                    ? "bg-sky-50 text-sky-700 ring-sky-200"
                    : "bg-red-50 text-red-700 ring-red-200"
              }`}
              title={slugVerdict.notes}
            >
              ✨ slug · {slugVerdict.verdict}
            </span>
            <span className="text-muted tabular-nums">
              {slugVerdict.score}/100
            </span>
          </div>
        ) : null}

        {/* score readouts */}
        <div className="grid grid-cols-2 gap-2 mt-1">
          <ScoreBlock label="Editorial" value={a.editorialScore} ok={ok} />
          <ScoreBlock label="SEO" value={a.seoScore} ok={ok} />
        </div>

        {/* top issue preview */}
        {inlineIssue ? (
          <div
            className={`text-xs mt-1 rounded-md border px-2.5 py-1.5 leading-snug ${
              inlineSeverity === "error"
                ? "bg-red-50 border-red-200 text-red-800"
                : inlineSeverity === "warning"
                  ? "bg-amber-50 border-amber-200 text-amber-800"
                  : "bg-stone-50 border-stone-200 text-stone-700"
            }`}
          >
            <span className="text-[10px] uppercase tracking-wide font-semibold mr-1">
              {ruleFilterId ? "Failing rule" : "First issue"}
            </span>
            <span className="font-normal">{inlineIssue}</span>
          </div>
        ) : ok && a.errorCount === 0 && a.warningCount === 0 ? (
          <div className="text-xs mt-1 rounded-md border px-2.5 py-1.5 leading-snug bg-emerald-50 border-emerald-200 text-emerald-800">
            All checks pass — no issues found.
          </div>
        ) : null}
      </div>

      {/* byline strip */}
      {a.article.author ? (
        <div className="px-4 py-1.5 border-t bg-stone-50/30 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted truncate">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">
              by
            </span>
            <span className="font-medium text-foreground">
              {a.article.author}
            </span>
            {matchedUser ? (
              <span className="text-muted">
                {" "}· mapped → {matchedUser.name}
              </span>
            ) : null}
          </span>
          <NotifyAuthorButton
            articleId={id}
            authorName={a.article.author}
            matchedUser={matchedUser}
            editorialScore={a.editorialScore}
            editorCount={editorCount}
            size="sm"
          />
        </div>
      ) : null}

      {/* action footer */}
      <div className="px-4 py-2.5 border-t bg-stone-50/50 flex items-center justify-between gap-2">
        <Link
          href={`/articles/${id}`}
          className="text-sm font-medium text-foreground hover:text-accent transition flex items-center gap-1"
        >
          View report
          <span aria-hidden="true">→</span>
        </Link>
        <a
          href={a.sitemap.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-muted hover:text-foreground transition flex items-center gap-1"
          title="Open the article on patrika.com"
        >
          Open article ↗
        </a>
      </div>
    </article>
  );
}

function ScoreBlock({
  label,
  value,
  ok,
}: {
  label: string;
  value: number;
  ok: boolean;
}) {
  const tone = !ok
    ? "text-stone-400 bg-stone-100"
    : value >= 80
      ? "text-emerald-700 bg-emerald-50"
      : value >= 60
        ? "text-amber-700 bg-amber-50"
        : "text-red-700 bg-red-50";
  return (
    <div className={`rounded-md px-2.5 py-1.5 ${tone}`}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums leading-none mt-0.5">
        {ok ? `${value}%` : "—"}
      </div>
    </div>
  );
}

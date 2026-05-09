import Link from "next/link";
import { getConfig } from "@/lib/config";
import { UserManager } from "@/components/UserManager";
import { EditorManager } from "@/components/EditorManager";
import { SectionManager } from "@/components/SectionManager";
import { CronHistory } from "@/components/CronHistory";
import { GeminiUsage } from "@/components/GeminiUsage";
import { listUsers } from "@/lib/users";
import { listEditors } from "@/lib/editors";
import { listSections } from "@/lib/sections";
import { listCronRuns } from "@/lib/dashboardStats";
import {
  getLifetimeGeminiUsage,
  listGeminiUsage,
} from "@/lib/geminiUsage";
import { rules } from "@/lib/rules";

// No caching. Settings reflects edits to authors / editors /
// sections immediately on the next page load, no 30s staleness.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SettingsPage() {
  const [
    cfg,
    users,
    editors,
    sections,
    cronRuns,
    geminiRows,
    geminiLifetime,
  ] = await Promise.all([
    getConfig(),
    listUsers(),
    listEditors(),
    listSections(),
    listCronRuns(50),
    listGeminiUsage(7),
    getLifetimeGeminiUsage(),
  ]);

  const editorialCount = rules.filter((r) => r.scope === "editorial").length;
  const seoCount = rules.filter((r) => r.scope === "seo").length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <span aria-hidden="true">←</span> Back to overview
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">
          Authors directory and the rule catalog used to score every
          article.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Authors</h2>
        <p className="text-xs text-muted">
          Auto-imported from article bylines as the cron scrapes them. Add
          a Telegram chat ID for any author you want nudges to reach.
        </p>
      </section>

      <UserManager
        initialUsers={users}
        telegramConfigured={!!cfg.telegramBotToken}
      />

      <EditorManager
        initialEditors={editors}
        telegramConfigured={!!cfg.telegramBotToken}
      />

      <SectionManager initialSections={sections} />

      <CronHistory runs={cronRuns} />

      <GeminiUsage rows={geminiRows} lifetime={geminiLifetime} />

      <section className="rounded-xl border bg-card p-5 space-y-2">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Rule catalog</h2>
          <span className="text-[11px] text-muted">
            {rules.length} rules · {editorialCount} editorial · {seoCount}{" "}
            SEO
          </span>
        </div>
        <p className="text-sm text-muted">
          The full list of checks every article runs through. Two scopes:
          editorial (Patrika.com checklist) and SEO (2026 Google best
          practices). Scoring is independent per scope.
        </p>
        <Link
          href="/rules"
          className="inline-block rounded-md border bg-stone-50 hover:bg-stone-100 px-3 py-1.5 text-sm"
        >
          Open rule catalog →
        </Link>
      </section>

    </div>
  );
}

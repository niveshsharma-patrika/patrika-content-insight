import Link from "next/link";
import { rules } from "@/lib/rules";
import { Badge } from "@/components/Badge";
import type { Rule, RuleScope } from "@/lib/types";

const CATEGORY_ORDER = [
  "url",
  "headline",
  "meta",
  "intro",
  "body",
  "image",
  "embed",
  "seo",
  "schema",
  "eeat",
  "discover",
];

function groupByCategory(list: Rule[]): Record<string, Rule[]> {
  const out: Record<string, Rule[]> = {};
  for (const r of list) {
    out[r.category] ??= [];
    out[r.category].push(r);
  }
  return out;
}

export default function RulesPage() {
  const editorialRules = rules.filter((r) => r.scope === "editorial");
  const seoRules = rules.filter((r) => r.scope === "seo");

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-10">
      <div>
        <Link
          href="/settings"
          className="text-sm text-muted hover:text-foreground"
        >
          ← Back to Settings
        </Link>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Rule catalog ({rules.length})
        </h1>
        <p className="text-sm text-muted">
          Two independent checklists. Each article is scored separately on
          editorial compliance (Patrika checklist) and SEO compliance (2026
          Google best practices).
        </p>
      </header>

      <RuleSection
        scope="editorial"
        kicker="Patrika.com editorial checklist"
        title={`Editorial rules · ${editorialRules.length}`}
        intro="Mechanically checkable items from Patrika's writer checklist — URL hygiene, headline craft, intro length, paragraph rhythm, image alt text, embed placement."
        groups={groupByCategory(editorialRules)}
      />

      <RuleSection
        scope="seo"
        kicker="2026 Google best practices"
        title={`SEO rules · ${seoRules.length}`}
        intro="Sourced from Google Search Central, Lighthouse SEO audit, web.dev, the March 2026 Core Update, the February 2026 Discover Core Update, and NewsArticle structured-data documentation."
        groups={groupByCategory(seoRules)}
      />
    </div>
  );
}

function RuleSection({
  scope,
  kicker,
  title,
  intro,
  groups,
}: {
  scope: RuleScope;
  kicker: string;
  title: string;
  intro: string;
  groups: Record<string, Rule[]>;
}) {
  const presentCategories = CATEGORY_ORDER.filter((c) => groups[c]?.length);
  return (
    <section className="space-y-3">
      <header
        className={`rounded-xl border p-5 ${
          scope === "seo"
            ? "bg-sky-50/40 border-sky-200"
            : "bg-amber-50/40 border-amber-200"
        }`}
      >
        <div className="text-[11px] uppercase tracking-wide text-muted font-medium">
          {kicker}
        </div>
        <h2 className="text-xl font-semibold tracking-tight mt-0.5">{title}</h2>
        <p className="text-sm text-muted mt-1">{intro}</p>
      </header>

      {presentCategories.map((cat) => (
        <div
          key={`${scope}-${cat}`}
          className="rounded-xl border bg-card overflow-hidden"
        >
          <div className="px-5 py-2.5 border-b bg-stone-50 flex items-baseline justify-between">
            <h3 className="font-semibold capitalize text-sm">{cat}</h3>
            <span className="text-xs text-muted">
              {groups[cat].length} rule
              {groups[cat].length === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="divide-y">
            {groups[cat].map((r) => (
              <li key={r.id} className="px-5 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{r.title}</span>
                  <Badge
                    variant={
                      r.severity === "error"
                        ? "error"
                        : r.severity === "warning"
                          ? "warning"
                          : "info"
                    }
                  >
                    {r.severity}
                  </Badge>
                  <span className="text-xs font-mono text-muted">{r.id}</span>
                </div>
                <p className="text-sm text-muted mt-1">{r.description}</p>
                {r.reference ? (
                  <p className="text-[11px] text-muted mt-1 italic">
                    {r.reference}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

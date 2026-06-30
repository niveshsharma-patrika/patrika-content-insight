import Link from "next/link";
import { rules } from "@/lib/rules";
import { Badge } from "@/components/Badge";
import { RuleToggle } from "@/components/RuleToggle";
import { getDisabledRuleIds } from "@/lib/ruleSettings";
import type { Rule, RuleScope } from "@/lib/types";

// Always fetch fresh — toggle state must be current after a flip.
export const dynamic = "force-dynamic";

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
  "amp",
];

function groupByCategory(list: Rule[]): Record<string, Rule[]> {
  const out: Record<string, Rule[]> = {};
  for (const r of list) {
    out[r.category] ??= [];
    out[r.category].push(r);
  }
  return out;
}

export default async function RulesPage() {
  const disabledIds = await getDisabledRuleIds({ forceRefresh: true });

  const editorialRules = rules.filter((r) => r.scope === "editorial");
  const seoRules = rules.filter((r) => r.scope === "seo");

  const editorialEnabled = editorialRules.filter(
    (r) => !disabledIds.has(r.id),
  ).length;
  const seoEnabled = seoRules.filter((r) => !disabledIds.has(r.id)).length;

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

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Rule catalog ({rules.length - disabledIds.size}/{rules.length}{" "}
          enabled)
        </h1>
        <p className="text-sm text-muted">
          Two independent checklists. Each article is scored separately on
          editorial compliance (Patrika checklist) and SEO compliance (2026
          Google best practices).
        </p>
        <p className="text-xs text-muted leading-relaxed">
          Toggle a rule off to remove it from scoring. Disabled rules
          don&apos;t affect editorial/SEO scores, won&apos;t appear in
          Top Issues, and won&apos;t trigger Telegram nudges. Changes
          take effect on the next page load (and the next cron tick for
          nudges).
        </p>
      </header>

      <RuleSection
        scope="editorial"
        kicker="Patrika.com editorial checklist"
        title={`Editorial rules · ${editorialEnabled}/${editorialRules.length} on`}
        intro="Mechanically checkable items from Patrika's writer checklist — URL hygiene, headline craft, intro length, paragraph rhythm, image alt text, embed placement."
        groups={groupByCategory(editorialRules)}
        disabledIds={disabledIds}
      />

      <RuleSection
        scope="seo"
        kicker="2026 Google best practices"
        title={`SEO rules · ${seoEnabled}/${seoRules.length} on`}
        intro="Sourced from Google Search Central, Lighthouse SEO audit, web.dev, the March 2026 Core Update, the February 2026 Discover Core Update, and NewsArticle structured-data documentation."
        groups={groupByCategory(seoRules)}
        disabledIds={disabledIds}
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
  disabledIds,
}: {
  scope: RuleScope;
  kicker: string;
  title: string;
  intro: string;
  groups: Record<string, Rule[]>;
  disabledIds: ReadonlySet<string>;
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

      {presentCategories.map((cat) => {
        const enabledInCat = groups[cat].filter(
          (r) => !disabledIds.has(r.id),
        ).length;
        return (
          <div
            key={`${scope}-${cat}`}
            className="rounded-xl border bg-card overflow-hidden"
          >
            <div className="px-5 py-2.5 border-b bg-stone-50 flex items-baseline justify-between">
              <h3 className="font-semibold capitalize text-sm">{cat}</h3>
              <span className="text-xs text-muted">
                {enabledInCat}/{groups[cat].length} on
              </span>
            </div>
            <ul className="divide-y">
              {groups[cat].map((r) => {
                const enabled = !disabledIds.has(r.id);
                return (
                  <li
                    key={r.id}
                    className={`px-5 py-3 ${
                      enabled ? "" : "bg-stone-50/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-medium text-sm ${
                              enabled ? "" : "text-muted line-through"
                            }`}
                          >
                            {r.title}
                          </span>
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
                          <span className="text-xs font-mono text-muted">
                            {r.id}
                          </span>
                        </div>
                        <p
                          className={`text-sm mt-1 ${
                            enabled ? "text-muted" : "text-muted/60"
                          }`}
                        >
                          {r.description}
                        </p>
                        {r.reference ? (
                          <p className="text-[11px] text-muted mt-1 italic">
                            {r.reference}
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 pt-0.5">
                        <RuleToggle
                          ruleId={r.id}
                          initialEnabled={enabled}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { Section } from "@/lib/sections";
import { Paginator } from "./Paginator";

const PER_PAGE = 20;

export function SectionManager({
  initialSections,
}: {
  initialSections: Section[];
}) {
  const [sections, setSections] = useState<Section[]>(initialSections);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.displayName.toLowerCase().includes(q),
    );
  }, [sections, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PER_PAGE;
  const visible = filtered.slice(start, start + PER_PAGE);

  const activeCount = sections.filter((s) => s.active).length;

  async function refresh() {
    const r = await fetch("/api/sections");
    const data = await r.json();
    if (data.ok) setSections(data.sections);
  }

  return (
    <section
      className="rounded-xl border bg-card overflow-hidden"
      id="sections"
    >
      <header className="px-5 py-3 border-b bg-stone-50/60">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Sections</h2>
          <span className="text-[11px] text-muted">
            {sections.length} imported · {activeCount} active
          </span>
        </div>
        <p className="text-xs text-muted mt-1">
          URL categories auto-imported from each scraped article (the
          first path segment of the URL). Rename a section&apos;s display
          label, or toggle it off to hide it from the dashboard&apos;s
          Sections filter.
        </p>
      </header>

      {sections.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No sections imported yet. They&apos;ll appear here as soon as
          the cron scrapes its first batch of articles.
        </p>
      ) : (
        <>
          <div className="px-5 py-2 border-b bg-stone-50/30">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter sections…"
              className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
            />
          </div>
          <ul className="divide-y">
            {visible.length === 0 ? (
              <li className="px-5 py-6 text-center text-sm text-muted">
                No sections match &ldquo;{query}&rdquo;.
              </li>
            ) : (
              visible.map((s) => (
                <li key={s.id}>
                  {editing === s.id ? (
                    <SectionForm
                      section={s}
                      onCancel={() => setEditing(null)}
                      onSaved={async () => {
                        setEditing(null);
                        await refresh();
                      }}
                    />
                  ) : (
                    <SectionRow
                      section={s}
                      onEdit={() => setEditing(s.id)}
                      onSaved={refresh}
                    />
                  )}
                </li>
              ))
            )}
          </ul>
          <Paginator
            page={safePage}
            pageCount={totalPages}
            total={filtered.length}
            onPage={setPage}
          />
        </>
      )}
    </section>
  );
}

function SectionRow({
  section,
  onEdit,
  onSaved,
}: {
  section: Section;
  onEdit: () => void;
  onSaved: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      await fetch(`/api/sections/${section.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ active: !section.active }),
      });
      await onSaved();
    });
  }

  return (
    <div className="px-5 py-3 grid grid-cols-12 items-center gap-3">
      <div className="col-span-5 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          <span
            className={`inline-block size-1.5 rounded-full ${
              section.active ? "bg-emerald-500" : "bg-stone-300"
            }`}
          />
          {section.displayName}
        </div>
        <div className="text-[11px] font-mono text-muted truncate mt-0.5">
          {section.id}
        </div>
      </div>
      <div className="col-span-5 text-[11px] text-muted">
        first seen{" "}
        <time
          dateTime={section.firstSeenAt}
          suppressHydrationWarning
          title={section.firstSeenAt}
        >
          {new Date(section.firstSeenAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
          })}
        </time>
      </div>
      <div className="col-span-2 flex items-center justify-end gap-3 text-xs">
        <button
          type="button"
          onClick={toggleActive}
          disabled={pending}
          className={`text-xs ${
            section.active
              ? "text-muted hover:text-foreground"
              : "text-amber-700 hover:text-amber-900"
          } disabled:opacity-60`}
          title={section.active ? "Hide from filter" : "Show in filter"}
        >
          {section.active ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-muted hover:text-foreground"
        >
          Rename
        </button>
      </div>
    </div>
  );
}

function SectionForm({
  section,
  onCancel,
  onSaved,
}: {
  section: Section;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(section.displayName);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await fetch(`/api/sections/${section.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      await onSaved();
    });
  }

  return (
    <div className="px-5 py-4 bg-stone-50/40 grid sm:grid-cols-[1fr_auto] gap-3 items-end">
      <div className="grid gap-1.5">
        <label className="text-[10px] uppercase tracking-wider text-muted font-medium">
          Display name
        </label>
        <input
          autoFocus
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
        <span className="text-[10px] text-muted font-mono">
          id: {section.id}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !displayName.trim()}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-stone-50"
        >
          Cancel
        </button>
      </div>
      {error ? (
        <span className="sm:col-span-2 text-sm text-red-700">{error}</span>
      ) : null}
    </div>
  );
}

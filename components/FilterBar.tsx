"use client";

import { useEffect, useRef, useState } from "react";

export type Status = "all" | "errors" | "warnings" | "clean" | "fetch_failed";
export type Sort = "score-asc" | "score-desc" | "recent" | "issues-desc";
export type ScopeFilter = "all" | "editorial" | "seo";

export type FilterState = {
  status: Status;
  scope: ScopeFilter;
  sections: string[];
  sort: Sort;
};

export const DEFAULT_FILTERS: FilterState = {
  status: "all",
  scope: "all",
  sections: [],
  sort: "recent",
};

const STATUS_OPTIONS: Array<{ id: Status; label: string }> = [
  { id: "all", label: "All articles" },
  { id: "errors", label: "With errors" },
  { id: "warnings", label: "Warnings only" },
  { id: "clean", label: "Clean" },
  { id: "fetch_failed", label: "Fetch failed" },
];

const SCOPE_OPTIONS: Array<{ id: ScopeFilter; label: string }> = [
  { id: "all", label: "Editorial + SEO" },
  { id: "editorial", label: "Editorial only" },
  { id: "seo", label: "SEO only" },
];

const SORT_OPTIONS: Array<{ id: Sort; label: string }> = [
  { id: "score-asc", label: "Lowest score first" },
  { id: "score-desc", label: "Highest score first" },
  { id: "recent", label: "Most recent" },
  { id: "issues-desc", label: "Most issues first" },
];

export function FilterBar({
  state,
  setState,
  totalOnPage,
  allCategories,
  resultCount,
}: {
  state: FilterState;
  setState: (s: FilterState) => void;
  totalOnPage: number;
  allCategories: string[];
  resultCount: number;
}) {
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    setState({ ...state, [k]: v });

  const toggleSection = (sec: string) => {
    const next = state.sections.includes(sec)
      ? state.sections.filter((s) => s !== sec)
      : [...state.sections, sec];
    set("sections", next);
  };

  const isDefault =
    state.status === "all" &&
    state.scope === "all" &&
    state.sections.length === 0;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      {/* Filter row: every control inline including Sections */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3">
        <Field label="Status" htmlFor="f-status">
          <select
            id="f-status"
            value={state.status}
            onChange={(e) => set("status", e.target.value as Status)}
            className="rounded-md border bg-card px-2.5 py-1.5 text-sm w-44"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Scope" htmlFor="f-scope">
          <select
            id="f-scope"
            value={state.scope}
            onChange={(e) => set("scope", e.target.value as ScopeFilter)}
            className="rounded-md border bg-card px-2.5 py-1.5 text-sm w-44"
          >
            {SCOPE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sections">
          <SectionsMultiSelect
            options={allCategories}
            selected={state.sections}
            onToggle={toggleSection}
            onClear={() => set("sections", [])}
            onSelectAll={() => set("sections", [...allCategories])}
          />
        </Field>

        <Field label="Sort" htmlFor="f-sort">
          <select
            id="f-sort"
            value={state.sort}
            onChange={(e) => set("sort", e.target.value as Sort)}
            className="rounded-md border bg-card px-2.5 py-1.5 text-sm"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {!isDefault ? (
          <button
            type="button"
            onClick={() => setState(DEFAULT_FILTERS)}
            className="ml-auto self-end rounded-md border bg-card px-2.5 py-1.5 text-sm text-muted hover:text-foreground hover:bg-stone-50"
          >
            Reset
          </button>
        ) : null}
      </div>

      {/* Active filter chips strip */}
      <div className="border-t px-4 py-2 bg-stone-50/40 flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted">
          <span className="font-medium tabular-nums text-foreground">
            {resultCount}
          </span>{" "}
          of {totalOnPage} on this page
        </span>
        {state.status !== "all" ? (
          <ActiveChip
            label={`Status: ${labelFor(STATUS_OPTIONS, state.status)}`}
            onClear={() => set("status", "all")}
          />
        ) : null}
        {state.scope !== "all" ? (
          <ActiveChip
            label={`Scope: ${labelFor(SCOPE_OPTIONS, state.scope)}`}
            onClear={() => set("scope", "all")}
          />
        ) : null}
        {state.sections.map((s) => (
          <ActiveChip
            key={`sec-${s}`}
            label={s}
            onClear={() => toggleSection(s)}
          />
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-[10px] uppercase tracking-wider text-muted font-medium"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function SectionsMultiSelect({
  options,
  selected,
  onToggle,
  onClear,
  onSelectAll,
}: {
  options: string[];
  selected: string[];
  onToggle: (s: string) => void;
  onClear: () => void;
  onSelectAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  // Close on outside click + escape
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label =
    selected.length === 0
      ? "All sections"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} sections`;

  const filtered = query.trim()
    ? options.filter((o) =>
        o.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : options;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border bg-card px-2.5 py-1.5 text-sm w-52 text-left flex items-center justify-between gap-2 hover:bg-stone-50"
      >
        <span
          className={`truncate ${selected.length === 0 ? "text-muted" : ""}`}
        >
          {label}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="M2 4 L5 7 L8 4"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-30 mt-1 w-72 rounded-lg border bg-card shadow-lg overflow-hidden"
        >
          <div className="px-3 py-2 border-b flex items-center gap-2">
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sections…"
              className="flex-1 rounded-md border bg-card px-2 py-1 text-sm"
            />
          </div>

          <div className="px-3 py-2 border-b flex items-center justify-between text-xs">
            <span className="text-muted">
              {selected.length} of {options.length} selected
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onSelectAll}
                className="text-muted hover:text-foreground"
              >
                Select all
              </button>
              <span className="text-stone-300">·</span>
              <button
                type="button"
                onClick={onClear}
                className="text-muted hover:text-foreground"
              >
                Clear
              </button>
            </div>
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted">
                No sections match.
              </li>
            ) : (
              filtered.map((s) => {
                const checked = selected.includes(s);
                return (
                  <li key={s}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={checked}
                      onClick={() => onToggle(s)}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-stone-50 ${
                        checked ? "bg-stone-50/60" : ""
                      }`}
                    >
                      <span
                        className={`size-4 rounded shrink-0 grid place-items-center border transition ${
                          checked
                            ? "bg-foreground border-foreground text-background"
                            : "bg-card border-stone-300"
                        }`}
                      >
                        {checked ? (
                          <svg
                            width="10"
                            height="10"
                            viewBox="0 0 10 10"
                            aria-hidden="true"
                          >
                            <path
                              d="M2 5 L4 7 L8 3"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </span>
                      <span className="truncate">{s}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ActiveChip({
  label,
  onClear,
}: {
  label: string;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-foreground text-background px-2 py-0.5 text-[11px] font-medium">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="hover:text-stone-300"
        aria-label={`Clear ${label}`}
      >
        ✕
      </button>
    </span>
  );
}

function labelFor<T extends { id: string; label: string }>(
  list: T[],
  id: string,
): string {
  return list.find((x) => x.id === id)?.label ?? id;
}

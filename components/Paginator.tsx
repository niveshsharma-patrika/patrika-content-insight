"use client";

/**
 * Generic client-side paginator for in-memory lists. Used by the
 * Authors and Sections directories in Settings, which paginate
 * already-fetched arrays without hitting the server.
 *
 * Renders a compact "Prev · 1 2 … N · Next" strip plus a position
 * caption ("Showing 21–40 of 132"). Hides itself entirely when there's
 * only one page.
 */
export function Paginator({
  page,
  pageCount,
  total,
  perPage = 20,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  perPage?: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;

  // Compact page list: first, last, current ±1, ellipses elsewhere.
  const items: Array<number | "ellipsis"> = [];
  const include = new Set<number>([1, pageCount]);
  for (let i = page - 1; i <= page + 1; i++) {
    if (i >= 1 && i <= pageCount) include.add(i);
  }
  let prev = 0;
  for (const i of [...include].sort((a, b) => a - b)) {
    if (prev && i - prev > 1) items.push("ellipsis");
    items.push(i);
    prev = i;
  }

  const start = (page - 1) * perPage + 1;
  const end = Math.min(total, page * perPage);

  return (
    <nav
      aria-label="Pagination"
      className="px-5 py-3 border-t bg-stone-50/30 flex items-center justify-between gap-3 flex-wrap"
    >
      <span className="text-[11px] text-muted">
        Showing{" "}
        <span className="tabular-nums">
          {start}–{end}
        </span>{" "}
        of <span className="tabular-nums">{total}</span>
      </span>
      <div className="flex items-center gap-1 flex-wrap">
        <PageBtn disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Prev
        </PageBtn>
        {items.map((it, i) =>
          it === "ellipsis" ? (
            <span key={`e-${i}`} className="px-1.5 text-muted text-sm">
              …
            </span>
          ) : (
            <PageBtn
              key={it}
              active={it === page}
              onClick={() => onPage(it)}
            >
              {it}
            </PageBtn>
          ),
        )}
        <PageBtn
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next ›
        </PageBtn>
      </div>
    </nav>
  );
}

function PageBtn({
  children,
  active = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  if (disabled) {
    return (
      <span className="px-2.5 py-1 text-xs text-muted-foreground select-none">
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`px-2.5 py-1 rounded-md text-xs tabular-nums transition ${
        active
          ? "bg-foreground text-background"
          : "border bg-card hover:bg-stone-50"
      }`}
    >
      {children}
    </button>
  );
}

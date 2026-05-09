import { getDb } from "./db";
import { categoryFromUrl } from "./utils";

/**
 * Sections (URL categories) directory.
 *
 * Sections are derived from each article's URL — the leading path
 * segment, like `jaipur-news` or `entertainment-news`. The cron auto-
 * upserts every section it encounters; the editor renames or
 * deactivates them in Settings → Sections. The dashboard's
 * FilterBar reads the active list to populate its Sections picker.
 */

export type Section = {
  id: string;
  displayName: string;
  active: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
};

type Row = {
  id: string;
  display_name: string;
  active: boolean | null;
  first_seen_at: string;
  last_seen_at: string;
};

function fromRow(r: Row): Section {
  return {
    id: r.id,
    displayName: r.display_name,
    active: r.active ?? true,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

export async function listSections(opts?: {
  activeOnly?: boolean;
}): Promise<Section[]> {
  const db = getDb();
  if (!db) return [];
  let q = db.from("sections").select("*").order("id", { ascending: true });
  if (opts?.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as Row[]).map(fromRow);
}

/**
 * Auto-import sections from a batch of article URLs. New section ids
 * become rows with a title-cased display name; already-known ids just
 * get their `last_seen_at` bumped.
 */
export async function ensureSectionsForUrls(
  urls: string[],
): Promise<{ created: number; touched: number }> {
  const db = getDb();
  if (!db) return { created: 0, touched: 0 };

  const ids = new Set<string>();
  for (const u of urls) {
    const cat = categoryFromUrl(u);
    if (cat && cat !== "—") ids.add(cat);
  }
  if (ids.size === 0) return { created: 0, touched: 0 };

  // Read what's already there.
  const { data } = await db.from("sections").select("id").in("id", [...ids]);
  const known = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));

  const now = new Date().toISOString();
  let created = 0;
  let touched = 0;

  // Bulk-insert any new ids in one round-trip.
  const newRows = [...ids]
    .filter((id) => !known.has(id))
    .map((id) => ({
      id,
      display_name: titleCase(id),
      active: true,
      first_seen_at: now,
      last_seen_at: now,
    }));
  if (newRows.length > 0) {
    const { error } = await db.from("sections").insert(newRows);
    if (!error) created = newRows.length;
  }

  // Bump last_seen_at for the rest.
  const seenIds = [...ids].filter((id) => known.has(id));
  if (seenIds.length > 0) {
    const { error } = await db
      .from("sections")
      .update({ last_seen_at: now })
      .in("id", seenIds);
    if (!error) touched = seenIds.length;
  }

  return { created, touched };
}

export async function updateSection(
  id: string,
  patch: { displayName?: string; active?: boolean },
): Promise<Section | null> {
  const db = getDb();
  if (!db) return null;
  const update: Record<string, unknown> = {};
  if (
    typeof patch.displayName === "string" &&
    patch.displayName.trim().length > 0
  ) {
    update.display_name = patch.displayName.trim();
  }
  if (typeof patch.active === "boolean") {
    update.active = patch.active;
  }
  if (Object.keys(update).length === 0) return null;
  const { data, error } = await db
    .from("sections")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) return null;
  return fromRow(data as Row);
}

function titleCase(id: string): string {
  return (
    id
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || id
  );
}

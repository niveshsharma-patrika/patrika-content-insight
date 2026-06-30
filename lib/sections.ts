import { sql, sqlOne, getPool } from "./db";
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
  if (!getPool()) return [];
  try {
    const rows = opts?.activeOnly
      ? await sql<Row>(
          `SELECT * FROM sections WHERE active = true ORDER BY id ASC`,
        )
      : await sql<Row>(`SELECT * FROM sections ORDER BY id ASC`);
    return rows.map(fromRow);
  } catch (err) {
    console.error(
      "[sections.listSections] select failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/**
 * Auto-import sections from a batch of article URLs. New section ids
 * become rows with a title-cased display name; already-known ids just
 * get their `last_seen_at` bumped.
 */
export async function ensureSectionsForUrls(
  urls: string[],
): Promise<{ created: number; touched: number }> {
  if (!getPool()) return { created: 0, touched: 0 };

  const ids = new Set<string>();
  for (const u of urls) {
    const cat = categoryFromUrl(u);
    if (cat && cat !== "—") ids.add(cat);
  }
  if (ids.size === 0) return { created: 0, touched: 0 };

  const idList = [...ids];

  // Read what's already there.
  let known = new Set<string>();
  try {
    const existing = await sql<{ id: string }>(
      `SELECT id FROM sections WHERE id = ANY($1::text[])`,
      [idList],
    );
    known = new Set(existing.map((r) => r.id));
  } catch (err) {
    console.error(
      "[sections.ensureSectionsForUrls] select failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { created: 0, touched: 0 };
  }

  const now = new Date().toISOString();
  let created = 0;
  let touched = 0;

  // Bulk-insert any new ids in one round-trip.
  const newIds = idList.filter((id) => !known.has(id));
  if (newIds.length > 0) {
    const cols: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const id of newIds) {
      cols.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
      params.push(id, titleCase(id), true, now, now);
    }
    try {
      await sql(
        `INSERT INTO sections (id, display_name, active, first_seen_at, last_seen_at)
         VALUES ${cols.join(",")}`,
        params,
      );
      created = newIds.length;
    } catch (err) {
      console.error(
        "[sections.ensureSectionsForUrls] insert failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Bump last_seen_at for the rest.
  const seenIds = idList.filter((id) => known.has(id));
  if (seenIds.length > 0) {
    try {
      await sql(
        `UPDATE sections SET last_seen_at = $1 WHERE id = ANY($2::text[])`,
        [now, seenIds],
      );
      touched = seenIds.length;
    } catch (err) {
      console.error(
        "[sections.ensureSectionsForUrls] update failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return { created, touched };
}

export async function updateSection(
  id: string,
  patch: { displayName?: string; active?: boolean },
): Promise<Section | null> {
  if (!getPool()) return null;
  const sets: string[] = [];
  const params: unknown[] = [];
  let p = 1;
  if (
    typeof patch.displayName === "string" &&
    patch.displayName.trim().length > 0
  ) {
    sets.push(`display_name = $${p++}`);
    params.push(patch.displayName.trim());
  }
  if (typeof patch.active === "boolean") {
    sets.push(`active = $${p++}`);
    params.push(patch.active);
  }
  if (sets.length === 0) return null;
  params.push(id);
  try {
    const row = await sqlOne<Row>(
      `UPDATE sections SET ${sets.join(", ")} WHERE id = $${p} RETURNING *`,
      params,
    );
    return row ? fromRow(row) : null;
  } catch (err) {
    console.error(
      "[sections.updateSection] update failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

function titleCase(id: string): string {
  return (
    id
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim() || id
  );
}

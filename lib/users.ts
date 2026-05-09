import { getDb } from "./db";

export type User = {
  id: string;
  name: string;
  /** Names that appear as bylines on Patrika articles. Matched case-insensitively. */
  aliases: string[];
  telegramChatId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  notes?: string;
};

type Row = {
  id: string;
  name: string;
  aliases: string[] | null;
  telegram_chat_id: string | null;
  active: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(r: Row): User {
  return {
    id: r.id,
    name: r.name,
    aliases: Array.isArray(r.aliases) ? r.aliases : [],
    telegramChatId: r.telegram_chat_id ?? undefined,
    active: r.active ?? true,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    notes: r.notes ?? undefined,
  };
}

function genId(): string {
  return `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listUsers(): Promise<User[]> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from("app_users")
    .select("*")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as Row[]).map(fromRow);
}

export type UpsertUserInput = {
  id?: string;
  name: string;
  aliases?: string[];
  telegramChatId?: string;
  active?: boolean;
  notes?: string;
};

export async function upsertUser(input: UpsertUserInput): Promise<User> {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const cleanAliases = (input.aliases ?? [])
    .map((a) => a.trim())
    .filter(Boolean);
  const now = new Date().toISOString();

  if (input.id) {
    const { data: existing, error: selErr } = await db
      .from("app_users")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (selErr || !existing) throw new Error("User not found");
    const prev = existing as Row;
    const update = {
      name: input.name.trim() || prev.name,
      aliases: cleanAliases.length ? cleanAliases : prev.aliases,
      telegram_chat_id:
        input.telegramChatId === undefined
          ? prev.telegram_chat_id
          : input.telegramChatId.trim() || null,
      active: input.active ?? prev.active,
      notes:
        input.notes === undefined
          ? prev.notes
          : input.notes.trim() || null,
      updated_at: now,
    };
    const { data, error } = await db
      .from("app_users")
      .update(update)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Update failed");
    return fromRow(data as Row);
  }

  const insert = {
    id: genId(),
    name: input.name.trim(),
    aliases: cleanAliases.length ? cleanAliases : [input.name.trim()],
    telegram_chat_id: input.telegramChatId?.trim() || null,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await db
    .from("app_users")
    .insert(insert)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Insert failed");
  return fromRow(data as Row);
}

export async function deleteUser(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("app_users").delete().eq("id", id);
}

/**
 * True when `alias` appears in `byline` as a whole word/phrase, not as
 * a sub-token. Prevents "Raj" from matching "Rajesh", "Sharma" from
 * matching "Sharmaji", etc. — which would have routed Telegram nudges
 * to the wrong author.
 *
 * Both sides are lowercased; alias must start AND end at a word
 * boundary inside the byline. Word boundaries here are anything that
 * isn't a Unicode letter, mark, or digit.
 */
function aliasMatchesByline(alias: string, byline: string): boolean {
  const a = alias.trim().toLowerCase();
  if (a.length < 3) return false;
  const hay = byline.toLowerCase();
  const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // (?:^|non-word-char) alias (?:non-word-char|$)
  const re = new RegExp(
    `(?:^|[^\\p{L}\\p{M}\\p{N}])${escaped}(?:[^\\p{L}\\p{M}\\p{N}]|$)`,
    "u",
  );
  return re.test(hay);
}

/**
 * Match a byline string against the configured users. Returns the first
 * user whose alias appears as a whole word/phrase inside the byline.
 */
export async function findUserForByline(
  byline: string | undefined,
): Promise<User | null> {
  if (!byline) return null;
  const list = await listUsers();
  for (const u of list) {
    if (!u.active) continue;
    for (const alias of u.aliases) {
      if (aliasMatchesByline(alias, byline)) return u;
    }
  }
  return null;
}

/**
 * Auto-import users from a batch of article bylines.
 *
 * Workflow: the cron scrapes a fresh batch of articles, gets their
 * `article.author` fields, and hands them to this function. Any byline
 * we haven't seen before gets a new `app_users` row with the byline as
 * both `name` and the only entry in `aliases`. The editor then opens
 * Settings → Authors and fills in the Telegram chat ID.
 *
 * Match rule (case-insensitive):
 *   - Skip if the byline equals an existing user's `name`, OR
 *   - Skip if the byline equals any existing alias.
 *
 * That's deliberately exact (not substring) so that "Aman Sharma" and
 * "Aman" become two separate users — the editor can merge them later
 * by adding aliases. Substring matching during creation would
 * prematurely collapse distinct authors.
 */
export async function ensureUsersForBylines(
  bylines: Array<string | undefined>,
): Promise<{ created: number; matched: number; skipped: number }> {
  const db = getDb();
  if (!db) return { created: 0, matched: 0, skipped: 0 };

  const cleanedSet = new Set<string>();
  let skipped = 0;
  for (const b of bylines) {
    const c = normalizeByline(b);
    if (c === null) {
      if (b && b.trim()) skipped += 1;
      continue;
    }
    cleanedSet.add(c);
  }
  const cleaned = Array.from(cleanedSet);
  if (cleaned.length === 0) return { created: 0, matched: 0, skipped };

  const existing = await listUsers();
  const known = new Set<string>();
  for (const u of existing) {
    known.add(u.name.trim().toLowerCase());
    for (const a of u.aliases) known.add(a.trim().toLowerCase());
  }

  let created = 0;
  let matched = 0;
  for (const byline of cleaned) {
    const lc = byline.toLowerCase();
    if (known.has(lc)) {
      matched += 1;
      continue;
    }
    try {
      await upsertUser({ name: byline, aliases: [byline], active: true });
      known.add(lc);
      created += 1;
    } catch (err) {
      console.warn(
        "[users.ensureUsersForBylines] create failed for",
        byline,
        err,
      );
    }
  }
  return { created, matched, skipped };
}

function normalizeByline(b: string | undefined): string | null {
  if (!b) return null;
  let s = b.trim().replace(/\s+/g, " ");
  // Strip an "By " prefix that occasionally leaks through scraping.
  s = s.replace(/^by\s+/i, "").trim();
  if (s.length < 2) return null;
  // Reject obvious non-name junk.
  if (s.includes("@")) return null;
  if (/^https?:\/\//i.test(s)) return null;
  if (/^[\d\s\-+().]+$/.test(s)) return null;
  return s;
}

/**
 * Bulk-resolve bylines → users. Single DB call. Same word-boundary
 * matching rule as `findUserForByline` so a "Raj" alias never
 * wrongly catches "Rajesh".
 */
export async function findUsersForBylines(
  bylines: Array<string | undefined>,
): Promise<Array<User | null>> {
  const list = await listUsers();
  const active = list.filter((u) => u.active);
  return bylines.map((b) => {
    if (!b) return null;
    for (const u of active) {
      for (const alias of u.aliases) {
        if (aliasMatchesByline(alias, b)) return u;
      }
    }
    return null;
  });
}

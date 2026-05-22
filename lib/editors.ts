import { getDb } from "./db";

/**
 * Editors are review-queue subscribers — they receive a Telegram nudge
 * for *every* article scoring below 80, regardless of who wrote it.
 *
 * Different from `app_users` (authors):
 *   • Authors are auto-imported from bylines and only get nudged for
 *     their own articles.
 *   • Editors are manually added in Settings, must have a chat ID at
 *     creation time, and get every low-score message.
 *
 * The same person can appear in both tables — the cron de-duplicates
 * by chat ID before sending, so they won't be messaged twice for the
 * same article.
 */

/**
 * Which kind of nudge an editor wants to receive.
 *
 *   • `editorial` — fires when editorialScore < 80 (existing behavior:
 *     headline, intro, image alt, word count, etc.)
 *   • `seo` — fires when seoScore < 80 (new: redirects, compression,
 *     cache headers, TTFB, AMP, etc.)
 *
 * An editor can have one or both. Storage is a TEXT[] in Postgres;
 * legacy rows without the column default to `['editorial']` so we
 * don't silently retarget anyone when the migration applies.
 */
export type EditorRole = "editorial" | "seo";

export type Editor = {
  id: string;
  name: string;
  telegramChatId: string;
  active: boolean;
  roles: EditorRole[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  name: string;
  telegram_chat_id: string;
  active: boolean | null;
  roles: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeRoles(raw: string[] | null | undefined): EditorRole[] {
  if (!raw || raw.length === 0) return ["editorial"];
  const out: EditorRole[] = [];
  for (const r of raw) {
    if (r === "editorial" || r === "seo") {
      if (!out.includes(r)) out.push(r);
    }
  }
  // An editor with zero valid roles is pointless — default to
  // editorial so they still receive something rather than nothing.
  return out.length > 0 ? out : ["editorial"];
}

function fromRow(r: Row): Editor {
  return {
    id: r.id,
    name: r.name,
    telegramChatId: r.telegram_chat_id,
    active: r.active ?? true,
    roles: normalizeRoles(r.roles),
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function genId(): string {
  return `edt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listEditors(opts?: {
  activeOnly?: boolean;
}): Promise<Editor[]> {
  const db = getDb();
  if (!db) return [];
  let q = db
    .from("editors")
    .select("*")
    .order("created_at", { ascending: true });
  if (opts?.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as Row[]).map(fromRow);
}

export type UpsertEditorInput = {
  id?: string;
  name: string;
  telegramChatId: string;
  active?: boolean;
  /** At least one role must be selected — defaults to ['editorial']. */
  roles?: EditorRole[];
  notes?: string;
};

function sanitizeRoles(
  raw: EditorRole[] | undefined,
): EditorRole[] | undefined {
  if (!raw) return undefined;
  const cleaned = normalizeRoles(raw);
  return cleaned;
}

export async function upsertEditor(input: UpsertEditorInput): Promise<Editor> {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const name = input.name.trim();
  const chatId = input.telegramChatId.trim();
  if (!name) throw new Error("Name is required");
  if (!chatId) throw new Error("Telegram chat ID is required");
  // Telegram chat_ids are signed integers (positive for users, negative
  // for groups). @usernames and phone numbers do NOT work with bots'
  // sendMessage — reject them up-front with a clear error.
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error(
      "Telegram chat ID must be a number (e.g. 123456789). " +
        "@usernames and phone numbers don't work — DM @userinfobot " +
        "on Telegram and copy the numeric 'Id' it shows.",
    );
  }

  const now = new Date().toISOString();

  if (input.id) {
    const { data: existing, error: selErr } = await db
      .from("editors")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (selErr || !existing) throw new Error("Editor not found");
    const prev = existing as Row;
    const cleanRoles = sanitizeRoles(input.roles);
    const update = {
      name: name || prev.name,
      telegram_chat_id: chatId || prev.telegram_chat_id,
      active: input.active ?? prev.active ?? true,
      roles: cleanRoles ?? prev.roles ?? ["editorial"],
      notes:
        input.notes === undefined ? prev.notes : input.notes.trim() || null,
      updated_at: now,
    };
    const { data, error } = await db
      .from("editors")
      .update(update)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message ?? "Update failed");
    return fromRow(data as Row);
  }

  const insert = {
    id: genId(),
    name,
    telegram_chat_id: chatId,
    active: input.active ?? true,
    roles: sanitizeRoles(input.roles) ?? ["editorial"],
    notes: input.notes?.trim() || null,
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await db
    .from("editors")
    .insert(insert)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Insert failed");
  return fromRow(data as Row);
}

export async function deleteEditor(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("editors").delete().eq("id", id);
}

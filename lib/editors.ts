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

export type Editor = {
  id: string;
  name: string;
  telegramChatId: string;
  active: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  id: string;
  name: string;
  telegram_chat_id: string;
  active: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(r: Row): Editor {
  return {
    id: r.id,
    name: r.name,
    telegramChatId: r.telegram_chat_id,
    active: r.active ?? true,
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
  notes?: string;
};

export async function upsertEditor(input: UpsertEditorInput): Promise<Editor> {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const name = input.name.trim();
  const chatId = input.telegramChatId.trim();
  if (!name) throw new Error("Name is required");
  if (!chatId) throw new Error("Telegram chat ID is required");

  const now = new Date().toISOString();

  if (input.id) {
    const { data: existing, error: selErr } = await db
      .from("editors")
      .select("*")
      .eq("id", input.id)
      .maybeSingle();
    if (selErr || !existing) throw new Error("Editor not found");
    const prev = existing as Row;
    const update = {
      name: name || prev.name,
      telegram_chat_id: chatId || prev.telegram_chat_id,
      active: input.active ?? prev.active ?? true,
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

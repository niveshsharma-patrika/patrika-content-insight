import { sql, sqlOne, exec, getPool } from "./db";

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
  if (!getPool()) return [];
  try {
    const rows = opts?.activeOnly
      ? await sql<Row>(
          `SELECT * FROM editors WHERE active = true ORDER BY created_at ASC`,
        )
      : await sql<Row>(`SELECT * FROM editors ORDER BY created_at ASC`);
    return rows.map(fromRow);
  } catch (err) {
    console.error(
      "[editors.listEditors] select failed:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
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
  if (!getPool()) throw new Error("Database not configured");
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
    const existing = await sqlOne<Row>(
      `SELECT * FROM editors WHERE id = $1`,
      [input.id],
    );
    if (!existing) throw new Error("Editor not found");
    const prev = existing;
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
    try {
      const row = await sqlOne<Row>(
        `UPDATE editors SET
           name = $2,
           telegram_chat_id = $3,
           active = $4,
           roles = $5::text[],
           notes = $6,
           updated_at = $7
         WHERE id = $1
         RETURNING *`,
        [
          input.id,
          update.name,
          update.telegram_chat_id,
          update.active,
          update.roles,
          update.notes,
          update.updated_at,
        ],
      );
      if (!row) throw new Error("Update failed");
      return fromRow(row);
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Update failed",
      );
    }
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
  try {
    const row = await sqlOne<Row>(
      `INSERT INTO editors (
         id, name, telegram_chat_id, active, roles, notes, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8)
       RETURNING *`,
      [
        insert.id,
        insert.name,
        insert.telegram_chat_id,
        insert.active,
        insert.roles,
        insert.notes,
        insert.created_at,
        insert.updated_at,
      ],
    );
    if (!row) throw new Error("Insert failed");
    return fromRow(row);
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Insert failed");
  }
}

export async function deleteEditor(id: string): Promise<void> {
  if (!getPool()) return;
  await exec(`DELETE FROM editors WHERE id = $1`, [id]);
}

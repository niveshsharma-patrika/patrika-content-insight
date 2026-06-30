/**
 * Login-user store (per-user dashboard accounts with roles).
 *
 * This is SEPARATE from `app_users` (article authors) and `editors`
 * (Telegram notification recipients) — those are content metadata.
 * `dashboard_users` are people who can log into the dashboard, each with
 * a permission tier (admin / editor / viewer).
 *
 * Node-runtime only (uses node:crypto scrypt for password hashing). Must
 * NOT be imported by `proxy.ts` (Edge) — the proxy only verifies the
 * signed cookie via `lib/auth.ts`, which is Web-Crypto based.
 *
 * The env DASHBOARD_USERNAME / DASHBOARD_PASSWORD remain a built-in
 * super-admin "break-glass" login so the owner can never be locked out.
 */

import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";
import { getDb } from "./db";
import { constantTimeEq, type Role } from "./auth";

export type DashboardUser = {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  active: boolean;
  created_at: string;
};

function rowToUser(r: UserRow): DashboardUser {
  return {
    id: r.id,
    username: r.username,
    role: (["admin", "editor", "viewer"].includes(r.role) ? r.role : "viewer") as Role,
    active: r.active,
    createdAt: r.created_at,
  };
}

// ---- Password hashing (scrypt) ----

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---- Authentication ----

/**
 * Resolve a username + password to a logged-in identity. Tries the DB
 * users first, then the env break-glass admin. Returns null on failure.
 */
export async function authenticateUser(
  username: string,
  password: string,
): Promise<{ user: string; role: Role } | null> {
  const db = getDb();
  if (db) {
    const { data } = await db
      .from("dashboard_users")
      .select("id,username,password_hash,role,active,created_at")
      .eq("username", username)
      .eq("active", true)
      .maybeSingle();
    const row = data as UserRow | null;
    if (row && verifyPassword(password, row.password_hash)) {
      return { user: row.username, role: rowToUser(row).role };
    }
  }

  // Env break-glass super-admin.
  const envUser = process.env.DASHBOARD_USERNAME?.trim();
  const envPass = process.env.DASHBOARD_PASSWORD;
  if (
    envUser &&
    envPass &&
    constantTimeEq(username, envUser) &&
    constantTimeEq(password, envPass)
  ) {
    return { user: envUser, role: "admin" };
  }

  return null;
}

// ---- CRUD (admin-managed) ----

export async function listDashboardUsers(): Promise<DashboardUser[]> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from("dashboard_users")
    .select("id,username,password_hash,role,active,created_at")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as UserRow[]).map(rowToUser);
}

export async function createDashboardUser(input: {
  username: string;
  password: string;
  role: Role;
}): Promise<{ ok: true; user: DashboardUser } | { ok: false; error: string }> {
  const db = getDb();
  if (!db) return { ok: false, error: "DB not configured" };
  const username = input.username.trim();
  if (!username) return { ok: false, error: "Username required" };
  if (!input.password || input.password.length < 8)
    return { ok: false, error: "Password must be at least 8 characters" };

  const { data, error } = await db
    .from("dashboard_users")
    .insert({
      id: randomUUID(),
      username,
      password_hash: hashPassword(input.password),
      role: input.role,
      active: true,
    })
    .select("id,username,password_hash,role,active,created_at")
    .single();
  if (error || !data) {
    // 23505 = unique violation (username taken).
    const msg = error?.code === "23505" ? "Username already exists" : error?.message ?? "Insert failed";
    return { ok: false, error: msg };
  }
  return { ok: true, user: rowToUser(data as UserRow) };
}

export async function updateDashboardUser(
  id: string,
  patch: { role?: Role; active?: boolean; password?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  if (!db) return { ok: false, error: "DB not configured" };
  const update: Record<string, unknown> = {};
  if (patch.role) update.role = patch.role;
  if (typeof patch.active === "boolean") update.active = patch.active;
  if (patch.password) {
    if (patch.password.length < 8)
      return { ok: false, error: "Password must be at least 8 characters" };
    update.password_hash = hashPassword(patch.password);
  }
  if (Object.keys(update).length === 0) return { ok: true };
  const { error } = await db.from("dashboard_users").update(update).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteDashboardUser(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.from("dashboard_users").delete().eq("id", id);
}

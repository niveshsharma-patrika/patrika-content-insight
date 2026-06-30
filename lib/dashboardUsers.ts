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
import { sql, sqlOne, exec, getPool, isUniqueViolation } from "./db";
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
  if (getPool()) {
    try {
      const row = await sqlOne<UserRow>(
        `SELECT id, username, password_hash, role, active, created_at
         FROM dashboard_users
         WHERE username = $1 AND active = true`,
        [username],
      );
      if (row && verifyPassword(password, row.password_hash)) {
        return { user: row.username, role: rowToUser(row).role };
      }
    } catch (err) {
      // DB unreachable (e.g. firewall, outage). Don't fail the login —
      // fall through to the env break-glass admin so the owner is never
      // locked out, which is the entire point of the break-glass.
      console.error(
        "[auth] dashboard_users lookup failed; falling back to env admin:",
        err instanceof Error ? err.message : String(err),
      );
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
  if (!getPool()) return [];
  const rows = await sql<UserRow>(
    `SELECT id, username, password_hash, role, active, created_at
     FROM dashboard_users
     ORDER BY created_at ASC`,
  );
  return rows.map(rowToUser);
}

export async function createDashboardUser(input: {
  username: string;
  password: string;
  role: Role;
}): Promise<{ ok: true; user: DashboardUser } | { ok: false; error: string }> {
  if (!getPool()) return { ok: false, error: "DB not configured" };
  const username = input.username.trim();
  if (!username) return { ok: false, error: "Username required" };
  if (!input.password || input.password.length < 8)
    return { ok: false, error: "Password must be at least 8 characters" };

  try {
    const row = await sqlOne<UserRow>(
      `INSERT INTO dashboard_users (id, username, password_hash, role, active)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, username, password_hash, role, active, created_at`,
      [randomUUID(), username, hashPassword(input.password), input.role],
    );
    if (!row) return { ok: false, error: "Insert failed" };
    return { ok: true, user: rowToUser(row) };
  } catch (err) {
    // 23505 = unique violation (username taken).
    if (isUniqueViolation(err)) {
      return { ok: false, error: "Username already exists" };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Insert failed" };
  }
}

export async function updateDashboardUser(
  id: string,
  patch: { role?: Role; active?: boolean; password?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!getPool()) return { ok: false, error: "DB not configured" };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.role) {
    params.push(patch.role);
    sets.push(`role = $${params.length}`);
  }
  if (typeof patch.active === "boolean") {
    params.push(patch.active);
    sets.push(`active = $${params.length}`);
  }
  if (patch.password) {
    if (patch.password.length < 8)
      return { ok: false, error: "Password must be at least 8 characters" };
    params.push(hashPassword(patch.password));
    sets.push(`password_hash = $${params.length}`);
  }
  if (sets.length === 0) return { ok: true };
  params.push(id);
  try {
    await exec(
      `UPDATE dashboard_users SET ${sets.join(", ")} WHERE id = $${params.length}`,
      params,
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed" };
  }
  return { ok: true };
}

export async function deleteDashboardUser(id: string): Promise<void> {
  if (!getPool()) return;
  await exec(`DELETE FROM dashboard_users WHERE id = $1`, [id]);
}

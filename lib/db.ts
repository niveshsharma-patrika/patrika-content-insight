import pg, { Pool, type PoolClient } from "pg";

/**
 * Server-only PostgreSQL access (Azure Database for PostgreSQL).
 *
 * Replaces the old Supabase (PostgREST) client. The app connects
 * directly to Postgres with the `pg` driver. Every consumer must be on
 * the server (route handlers, RSCs) — never expose this to the browser.
 *
 * Env (all server-side):
 *   PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT (default 5432)
 *   PGSSLMODE=require   (Azure requires TLS)
 *
 * Type parsers below keep the JS shapes IDENTICAL to what the Supabase
 * client used to return, so consumers didn't have to change their
 * expectations:
 *   - bigint / int8        → number   (ids, counts)
 *   - numeric              → number   (cls, scores)
 *   - timestamptz/timestamp → ISO 8601 string (not a Date object)
 *   - date                 → "YYYY-MM-DD" string (no TZ shift)
 *   - json / jsonb / arrays → parsed JS values (pg does this already)
 */

// int8 (oid 20) and numeric (1700) → JS number.
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// timestamptz (1184) / timestamp (1114) → ISO string, matching PostgREST.
pg.types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString()));
pg.types.setTypeParser(1114, (v) => (v === null ? null : new Date(v).toISOString()));
// date (1082) → keep the raw "YYYY-MM-DD" string (avoid Date TZ rollover).
pg.types.setTypeParser(1082, (v) => v);

let _pool: Pool | null | "missing" = null;

export function getPool(): Pool | null {
  if (_pool === "missing") return null;
  if (_pool) return _pool;
  const host = process.env.PGHOST;
  const user = process.env.PGUSER;
  const password = process.env.PGPASSWORD;
  const database = process.env.PGDATABASE;
  if (!host || !user || !password || !database) {
    console.warn(
      "[db] PGHOST/PGUSER/PGPASSWORD/PGDATABASE missing — DB calls will be no-ops.",
    );
    _pool = "missing";
    return null;
  }
  _pool = new Pool({
    host,
    user,
    password,
    database,
    port: Number(process.env.PGPORT ?? 5432),
    // Azure Flexible Server requires TLS. rejectUnauthorized:false accepts
    // the server cert without pinning a CA — fine for now; pass the Azure
    // CA via PGSSLROOTCERT later for strict verification.
    ssl:
      process.env.PGSSLMODE === "disable"
        ? false
        : { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    // Fail fast when the DB is unreachable (e.g. firewall) so requests
    // don't hang for 15s each — login falls back to the env admin
    // quickly and pages render their empty state instead of stalling.
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 4_000),
    query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 12_000),
  });
  _pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });
  return _pool;
}

export function isDbConfigured(): boolean {
  return getPool() !== null;
}

/** Run a query and return all rows (typed). No-op → [] when unconfigured. */
export async function sql<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = getPool();
  if (!pool) return [];
  const res = await pool.query(text, params as unknown[]);
  return res.rows as T[];
}

/** Run a query and return the first row, or null. */
export async function sqlOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await sql<T>(text, params);
  return rows[0] ?? null;
}

/** Run a write/DDL query and return the number of affected rows. */
export async function exec(text: string, params: unknown[] = []): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const res = await pool.query(text, params as unknown[]);
  return res.rowCount ?? 0;
}

/** Run fn inside a transaction with a dedicated client. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T | null> {
  const pool = getPool();
  if (!pool) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** True when an error is a Postgres unique-violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

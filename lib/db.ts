import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client.
 * Uses the SERVICE_ROLE key — full DB access. Never expose this client to
 * the browser. Every consumer must be on the server (route handlers, RSCs,
 * server actions).
 */
let _client: SupabaseClient | null | "missing" = null;

export function getDb(): SupabaseClient | null {
  if (_client === "missing") return null;
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn(
      "[db] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — DB calls will be no-ops.",
    );
    _client = "missing";
    return null;
  }
  _client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "public" },
  });
  return _client;
}

export function isDbConfigured(): boolean {
  return getDb() !== null;
}

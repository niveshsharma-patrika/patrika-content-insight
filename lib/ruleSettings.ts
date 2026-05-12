import { getDb } from "./db";

/**
 * Editor-controlled on/off switches for rules in the catalog.
 *
 * Storage:
 *   `rule_overrides(rule_id PK, enabled BOOLEAN)` — only rules that have
 *   been touched have a row. A rule with no row is considered enabled
 *   (the default). That way new rules added in code automatically
 *   participate without any data migration.
 *
 * Read pattern:
 *   `getDisabledRuleIds()` returns the set of rule IDs to skip. Cached
 *   in-memory for 5 minutes so a typical dashboard render hits Supabase
 *   at most once per process per 5-min window. Mutations
 *   (`setRuleEnabled`) invalidate the cache immediately so the next read
 *   in the same process sees the change.
 *
 * Fail-soft:
 *   If the DB query errors (e.g. migration not yet applied, network
 *   blip), we log and return an empty set. That means "no rules
 *   disabled" — safer than silently dropping rules from scoring.
 */

type CacheEntry = { ids: Set<string>; fetchedAt: number };
const TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

export async function getDisabledRuleIds(opts?: {
  forceRefresh?: boolean;
}): Promise<Set<string>> {
  const now = Date.now();
  if (
    !opts?.forceRefresh &&
    cache &&
    now - cache.fetchedAt < TTL_MS
  ) {
    return cache.ids;
  }

  const db = getDb();
  if (!db) {
    cache = { ids: new Set(), fetchedAt: now };
    return cache.ids;
  }

  const { data, error } = await db
    .from("rule_overrides")
    .select("rule_id,enabled")
    .eq("enabled", false);

  if (error) {
    // Most likely "table not found" before the migration is applied.
    // Warn once-ish (TTL still applies so this won't spam) and treat
    // as no overrides — every rule remains enabled.
    console.warn(
      "[ruleSettings.getDisabledRuleIds] read failed, defaulting to all-enabled:",
      error.message,
    );
    cache = { ids: new Set(), fetchedAt: now };
    return cache.ids;
  }

  const ids = new Set<string>(
    (data as Array<{ rule_id: string; enabled: boolean }> | null)?.map(
      (r) => r.rule_id,
    ) ?? [],
  );
  cache = { ids, fetchedAt: now };
  return ids;
}

/**
 * Set the enabled state for a rule. Writes a row to `rule_overrides`
 * (upsert) and invalidates the in-memory cache. The next call to
 * `getDisabledRuleIds()` will re-fetch.
 */
export async function setRuleEnabled(
  ruleId: string,
  enabled: boolean,
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not configured");
  const { error } = await db.from("rule_overrides").upsert(
    {
      rule_id: ruleId,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "rule_id" },
  );
  if (error) throw new Error(error.message);
  // Force next read to re-fetch — cheaper than mutating the cached set
  // and getting the cross-process picture wrong.
  cache = null;
}

/**
 * For the rules page: read every row in `rule_overrides` so we can show
 * the editor which ones are explicitly toggled (vs. on by default).
 * Used purely for UI; scoring only cares about the disabled set.
 */
export async function readAllOverrides(): Promise<
  Array<{ ruleId: string; enabled: boolean; updatedAt: string | null }>
> {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db
    .from("rule_overrides")
    .select("rule_id,enabled,updated_at");
  if (error || !data) return [];
  return (
    data as Array<{
      rule_id: string;
      enabled: boolean;
      updated_at: string | null;
    }>
  ).map((r) => ({
    ruleId: r.rule_id,
    enabled: r.enabled,
    updatedAt: r.updated_at,
  }));
}

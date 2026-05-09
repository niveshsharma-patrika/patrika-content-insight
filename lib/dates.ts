/**
 * IST date helpers. Centralizes the timezone math so callers never have
 * to think about UTC↔IST conversion.
 *
 * "IST date" here means a YYYY-MM-DD string anchored to Asia/Kolkata
 * (UTC+5:30). Patrika publishes from India, so "today" / "yesterday"
 * is reckoned by IST midnight, not the host server's clock.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function todayInIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}

/**
 * Returns YYYY-MM-DD for `n` days before today (IST). `n=0` is today,
 * `n=1` is yesterday, etc.
 */
export function istDateMinusDays(n: number): string {
  const today = todayInIST();
  const [y, m, d] = today.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - n * 24 * 60 * 60 * 1000;
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * The last N IST dates, newest-first. `lastNIstDays(7)` returns
 * [today, yesterday, …, 6 days ago].
 */
export function lastNIstDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => istDateMinusDays(i));
}

/** Cheap shape check for `?date=` query strings. */
export function isValidIstDateString(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Coerce a user-supplied date string to one inside the retention
 * window. Falls back to today if it's missing, malformed, or outside
 * the last `windowDays` days. Never returns a future date.
 */
export function clampDateToWindow(
  raw: unknown,
  windowDays: number,
): string {
  if (!isValidIstDateString(raw)) return todayInIST();
  const allowed = new Set(lastNIstDays(windowDays));
  return allowed.has(raw) ? raw : todayInIST();
}

/**
 * "Today" / "Yesterday" / "Wed 7 May" — short label for date chips.
 */
export function dayChipLabel(istDate: string): string {
  const today = todayInIST();
  if (istDate === today) return "Today";
  if (istDate === istDateMinusDays(1)) return "Yesterday";
  // Build a date in UTC at noon to avoid TZ rollover quirks.
  const [y, m, d] = istDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0));
  return dt.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * Long, header-friendly form: "Friday, 9 May".
 */
export function dayHeaderLabel(istDate: string): string {
  const [y, m, d] = istDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0));
  return dt.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

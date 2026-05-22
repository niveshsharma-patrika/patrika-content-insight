/**
 * Session-cookie helpers for the dashboard auth gate.
 *
 * Design notes:
 *
 *   • Cookie format is `<payload>.<signature>` (JWT-ish but smaller).
 *     payload   = base64url(JSON.stringify({ user, exp }))
 *     signature = base64url(HMAC-SHA256(payload, secret))
 *
 *   • The signing key is derived from DASHBOARD_PASSWORD via SHA-256.
 *     Side effect we like: rotating the password automatically
 *     invalidates every existing session, no separate revocation
 *     mechanism needed.
 *
 *   • Web Crypto is used (not Node's `crypto`) because the proxy runs
 *     on the Edge runtime by default in Next 16. The exact same code
 *     works in the Node-runtime API routes — both have crypto.subtle.
 *
 *   • Constant-time signature compare via crypto.subtle.verify, which
 *     handles timing safety internally.
 *
 *   • Cookie lifetime is 30 days. That matches "log in once a month"
 *     UX for editors; can be bumped if it turns out to be annoying.
 */

const COOKIE_NAME = "pci_session";
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
const PAYLOAD_VERSION = 1;

export type SessionPayload = {
  /** Username at time of login. Kept for /api/auth/whoami / logging. */
  user: string;
  /** Expiry as ms since epoch. Validated alongside cookie Max-Age. */
  exp: number;
  /** Payload schema version — so future changes can invalidate old cookies. */
  v: number;
};

/** Returns true when both credentials are set in the env. */
export function isAuthConfigured(): boolean {
  return (
    !!process.env.DASHBOARD_USERNAME?.trim() && !!process.env.DASHBOARD_PASSWORD
  );
}

/** Constant-time string compare for the username/password check. */
export function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function base64UrlEncode(bytes: Uint8Array): string {
  // Convert via binary string → btoa → url-safe alphabet.
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function getSigningKey(): Promise<CryptoKey> {
  const pw = process.env.DASHBOARD_PASSWORD ?? "";
  // Derive a 32-byte HMAC key from the password. Cheap KDF — fine
  // because the password is already the strong shared secret.
  const seed = await crypto.subtle.digest("SHA-256", enc.encode(`pci-session-v1|${pw}`));
  return crypto.subtle.importKey(
    "raw",
    seed,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Build a signed session cookie value for the given username.
 * Cookie is valid for COOKIE_MAX_AGE_SECONDS from now.
 */
export async function createSessionCookieValue(user: string): Promise<string> {
  const payload: SessionPayload = {
    user,
    exp: Date.now() + COOKIE_MAX_AGE_SECONDS * 1000,
    v: PAYLOAD_VERSION,
  };
  const payloadBytes = enc.encode(JSON.stringify(payload));
  const payloadB64 = base64UrlEncode(payloadBytes);
  const key = await getSigningKey();
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64)),
  );
  return `${payloadB64}.${base64UrlEncode(sigBytes)}`;
}

/**
 * Verify a cookie value. Returns the decoded payload when:
 *   • signature is valid
 *   • payload parses
 *   • exp is in the future
 *   • payload version matches
 * Otherwise returns null. Never throws on malformed input.
 */
export async function verifySessionCookieValue(
  value: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  const payloadB64 = value.slice(0, dot);
  const sigB64 = value.slice(dot + 1);

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(sigB64);
  } catch {
    return null;
  }

  let key: CryptoKey;
  try {
    key = await getSigningKey();
  } catch {
    return null;
  }

  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as unknown as ArrayBuffer,
      enc.encode(payloadB64),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let json: unknown;
  try {
    json = JSON.parse(dec.decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const p = json as Record<string, unknown>;
  if (typeof p.user !== "string" || typeof p.exp !== "number" || p.v !== PAYLOAD_VERSION) {
    return null;
  }
  if (p.exp <= Date.now()) return null;
  return { user: p.user, exp: p.exp, v: p.v };
}

/**
 * Serialize a Set-Cookie value with the right flags for the
 * environment. Server-side use only (proxy + route handlers).
 */
export function buildSetCookieHeader(value: string): string {
  const flags = [
    `${COOKIE_NAME}=${value}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  // Localhost doesn't run over HTTPS, so the Secure flag would prevent
  // the cookie from being stored at all in dev. Detect via NODE_ENV
  // — Vercel sets it to "production" in prod / preview.
  if (process.env.NODE_ENV === "production") flags.push("Secure");
  return flags.join("; ");
}

export function buildClearCookieHeader(): string {
  const flags = [
    `${COOKIE_NAME}=`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Max-Age=0`,
  ];
  if (process.env.NODE_ENV === "production") flags.push("Secure");
  return flags.join("; ");
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Controlled login form. Submits to /api/auth/login.
 *
 * On 200 we hard-navigate (window.location) to the post-login target
 * rather than router.push() so the server re-evaluates the proxy with
 * the freshly-set cookie. router.push relies on the RSC payload that
 * was fetched during render — which on /login is unauthenticated.
 */
export function LoginForm({ nextPath }: { nextPath: string }) {
  useRouter(); // imported for type-safety / future use
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const r = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = (await r.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
        };
        if (!r.ok || !data.ok) {
          setError(data.error ?? "Login failed.");
          return;
        }
        // Hard nav so the proxy re-runs with the new cookie.
        window.location.href = nextPath || "/";
      } catch {
        setError("Network error — try again.");
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border bg-card shadow-sm p-6 space-y-4"
    >
      <div className="space-y-1.5">
        <label
          htmlFor="username"
          className="text-[10px] uppercase tracking-wider text-muted font-medium"
        >
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          autoFocus
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-md border bg-card px-3 py-2 text-sm"
          placeholder="e.g. patrika"
        />
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="password"
          className="text-[10px] uppercase tracking-wider text-muted font-medium"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
      </div>
      {error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending || !username.trim() || !password}
        className="w-full rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:bg-stone-800 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

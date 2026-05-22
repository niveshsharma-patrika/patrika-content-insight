"use client";

import { useState, useTransition } from "react";

/**
 * Logout button — POSTs to /api/auth/logout (which clears the session
 * cookie) and then hard-navigates to /login. Hard nav is intentional
 * so the proxy re-evaluates with the cleared cookie.
 */
export function LogoutButton({ className }: { className?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function logout() {
    setError(null);
    startTransition(async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST" });
        window.location.href = "/login";
      } catch {
        setError("Logout failed — try again.");
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={logout}
        disabled={pending}
        className={
          className ??
          "text-xs text-muted hover:text-foreground disabled:opacity-60"
        }
        title="Sign out and clear the session cookie"
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error ? (
        <span className="text-xs text-red-700">{error}</span>
      ) : null}
    </span>
  );
}

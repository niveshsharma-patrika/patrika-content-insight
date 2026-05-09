"use client";

import Link from "next/link";
import { useState } from "react";
import type { User } from "@/lib/users";

type Props = {
  articleId: string;
  authorName?: string;
  matchedUser: Pick<User, "name" | "telegramChatId"> | null;
  editorialScore: number;
  /** Visual size — "sm" for cards, "lg" for the article detail page. */
  size?: "sm" | "lg";
};

export function NotifyAuthorButton({
  articleId,
  authorName,
  matchedUser,
  editorialScore,
  size = "sm",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; tone: "good" | "bad" } | null>(
    null,
  );

  // Only useful when the article is below threshold AND we have someone to ping.
  if (editorialScore >= 80) return null;

  // No byline at all → encourage adding one in users settings, but don't block UI
  if (!authorName) {
    return (
      <Link
        href="/settings#users"
        className={
          size === "lg"
            ? "rounded-md border bg-stone-50 text-stone-700 px-3 py-1.5 text-sm hover:bg-stone-100"
            : "text-[11px] text-muted hover:text-foreground"
        }
        title="No byline detected; add a default editor in Settings"
      >
        {size === "lg" ? "No byline detected" : "no byline"}
      </Link>
    );
  }

  if (!matchedUser) {
    return (
      <Link
        href="/settings#users"
        className={
          size === "lg"
            ? "rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-1.5 text-sm hover:bg-amber-100"
            : "text-[11px] text-amber-700 hover:underline"
        }
        title={`Byline "${authorName}" doesn't match any user. Map it in Settings.`}
      >
        {size === "lg"
          ? `+ Map "${authorName}"`
          : `+ map "${truncate(authorName, 16)}"`}
      </Link>
    );
  }

  if (!matchedUser.telegramChatId) {
    return (
      <Link
        href="/settings#users"
        className={
          size === "lg"
            ? "rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-1.5 text-sm hover:bg-amber-100"
            : "text-[11px] text-amber-700 hover:underline"
        }
        title={`${matchedUser.name} has no Telegram chat ID configured`}
      >
        + add chat ID for {truncate(matchedUser.name, 18)}
      </Link>
    );
  }

  async function send() {
    setBusy(true);
    setDone(null);
    try {
      const r = await fetch("/api/telegram/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: articleId }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok)
        throw new Error(data.error ?? "Telegram send failed");
      setDone({
        text: `Sent to ${data.sent.userName}`,
        tone: "good",
      });
    } catch (err) {
      setDone({ text: (err as Error).message, tone: "bad" });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <span
        className={`text-[11px] ${
          done.tone === "good" ? "text-emerald-700" : "text-red-700"
        }`}
      >
        {done.text}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={busy}
      title={`Send a Telegram nudge to ${matchedUser.name}`}
      className={
        size === "lg"
          ? "inline-flex items-center gap-1.5 rounded-md bg-sky-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-sky-700 disabled:opacity-60"
          : "inline-flex items-center gap-1 rounded-md bg-sky-50 text-sky-800 ring-1 ring-sky-200 px-1.5 py-0.5 text-[11px] font-medium hover:bg-sky-100 disabled:opacity-60"
      }
    >
      <span aria-hidden="true">{busy ? "…" : "✈︎"}</span>
      {busy ? "Sending…" : `Notify ${truncate(matchedUser.name.split(" ")[0], 12)}`}
    </button>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

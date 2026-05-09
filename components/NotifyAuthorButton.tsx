"use client";

import Link from "next/link";
import { useState } from "react";
import type { User } from "@/lib/users";

type Props = {
  articleId: string;
  authorName?: string;
  matchedUser: Pick<User, "name" | "telegramChatId"> | null;
  editorialScore: number;
  /** Number of active editors with chat IDs in the system. When >0,
   *  Notify is always actionable — editors are real recipients even
   *  if the author isn't mapped or has no chat ID. */
  editorCount?: number;
  /** Visual size — "sm" for cards, "lg" for the article detail page. */
  size?: "sm" | "lg";
};

export function NotifyAuthorButton({
  articleId,
  authorName,
  matchedUser,
  editorialScore,
  editorCount = 0,
  size = "sm",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; tone: "good" | "bad" } | null>(
    null,
  );

  // Only useful when the article is below threshold.
  if (editorialScore >= 80) return null;

  const authorIsReachable =
    !!matchedUser && !!matchedUser.telegramChatId;
  const canNotify = authorIsReachable || editorCount > 0;

  // If neither the author nor any editor can receive a message, surface
  // a helpful link instead of a dead button. Three sub-cases for
  // clarity, all of which point the editor at Settings to fix it.
  if (!canNotify) {
    if (!authorName) {
      return (
        <Link
          href="/settings#editors"
          className={
            size === "lg"
              ? "rounded-md border bg-stone-50 text-stone-700 px-3 py-1.5 text-sm hover:bg-stone-100"
              : "text-[11px] text-muted hover:text-foreground"
          }
          title="No byline detected and no editors configured. Add an editor in Settings."
        >
          {size === "lg" ? "No byline · no editors" : "no recipients"}
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
          title={`Byline "${authorName}" doesn't match any user. Map it in Settings, or add an editor.`}
        >
          {size === "lg"
            ? `+ Map "${authorName}"`
            : `+ map "${truncate(authorName, 16)}"`}
        </Link>
      );
    }
    // matchedUser exists but no chat ID and no editors
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
        text: data.summary ?? "Sent",
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

  // Build a label that reflects who's actually getting pinged.
  const label = (() => {
    if (busy) return "Sending…";
    if (authorIsReachable && editorCount > 0) {
      return `Notify ${truncate(matchedUser!.name.split(" ")[0], 12)} + ${editorCount}`;
    }
    if (authorIsReachable) {
      return `Notify ${truncate(matchedUser!.name.split(" ")[0], 12)}`;
    }
    return `Notify ${editorCount} editor${editorCount === 1 ? "" : "s"}`;
  })();

  const tooltip = authorIsReachable
    ? editorCount > 0
      ? `Send a Telegram nudge to ${matchedUser!.name} and ${editorCount} editor${editorCount === 1 ? "" : "s"}`
      : `Send a Telegram nudge to ${matchedUser!.name}`
    : `Send a Telegram nudge to ${editorCount} editor${editorCount === 1 ? "" : "s"}`;

  return (
    <button
      type="button"
      onClick={send}
      disabled={busy}
      title={tooltip}
      className={
        size === "lg"
          ? "inline-flex items-center gap-1.5 rounded-md bg-sky-600 text-white px-3 py-1.5 text-sm font-medium hover:bg-sky-700 disabled:opacity-60"
          : "inline-flex items-center gap-1 rounded-md bg-sky-50 text-sky-800 ring-1 ring-sky-200 px-1.5 py-0.5 text-[11px] font-medium hover:bg-sky-100 disabled:opacity-60"
      }
    >
      <span aria-hidden="true">{busy ? "…" : "✈︎"}</span>
      {label}
    </button>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

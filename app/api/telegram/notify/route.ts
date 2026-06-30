import { NextResponse } from "next/server";
import { getArticleAnalysisById } from "@/lib/analyze";
import { findUserForByline } from "@/lib/users";
import { listEditors } from "@/lib/editors";
import {
  buildAuthorAlert,
  isTelegramConfigured,
  sendTelegramMessage,
} from "@/lib/telegram";
import { requireRole } from "@/lib/session";

/**
 * Manual "Notify" trigger from the dashboard. Fan-out rules match
 * the cron's auto-nudge:
 *   • The matched author (if any) gets a personal-tone message.
 *   • Every active editor with a chat ID gets a heads-up message.
 *   • Recipients are deduped by chat ID — author-who-is-also-an-editor
 *     receives one message, framed as the author version.
 *
 * Returns a list of who was sent and who was skipped (with reason).
 */
export async function POST(req: Request) {
  const gate = await requireRole("editor");
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const id = typeof body?.id === "string" ? body.id : undefined;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing article id" },
      { status: 400 },
    );
  }
  if (!(await isTelegramConfigured())) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Telegram bot token not configured. Set TELEGRAM_BOT_TOKEN env var.",
      },
      { status: 400 },
    );
  }

  const a = await getArticleAnalysisById(id);
  if (!a) {
    return NextResponse.json(
      { ok: false, error: "Article not found in DB" },
      { status: 404 },
    );
  }
  if (!a.article.ok) {
    return NextResponse.json(
      { ok: false, error: "Article fetch failed — cannot evaluate" },
      { status: 422 },
    );
  }

  const matchedUser = await findUserForByline(a.article.author);
  const editors = (await listEditors({ activeOnly: true })).filter(
    (e) => e.telegramChatId,
  );

  // Build the recipient set. Author wins on chat-ID collisions: if a
  // person is both author and editor, they get the author-tone msg.
  type Recipient = {
    chatId: string;
    name: string;
    forEditor: boolean;
  };
  const byChat = new Map<string, Recipient>();
  if (matchedUser?.active && matchedUser.telegramChatId) {
    byChat.set(matchedUser.telegramChatId, {
      chatId: matchedUser.telegramChatId,
      name: matchedUser.name,
      forEditor: false,
    });
  }
  for (const ed of editors) {
    if (byChat.has(ed.telegramChatId)) continue;
    byChat.set(ed.telegramChatId, {
      chatId: ed.telegramChatId,
      name: ed.name,
      forEditor: true,
    });
  }

  if (byChat.size === 0) {
    const reason = !matchedUser
      ? a.article.author
        ? `No user mapping for byline "${a.article.author}", and no editors configured.`
        : "Article has no detected byline, and no editors configured."
      : !matchedUser.telegramChatId
        ? `Author "${matchedUser.name}" has no Telegram chat ID, and no editors configured.`
        : "No active recipients with Telegram chat IDs.";
    return NextResponse.json({ ok: false, error: reason }, { status: 400 });
  }

  // Compose the editorial-only top issues once — same payload for everyone.
  const topIssues = a.results
    .filter((r) => !r.result.passed && r.rule.scope === "editorial")
    .sort(
      (x, y) =>
        (y.rule.severity === "error"
          ? 3
          : y.rule.severity === "warning"
            ? 2
            : 1) -
        (x.rule.severity === "error"
          ? 3
          : x.rule.severity === "warning"
            ? 2
            : 1),
    )
    .slice(0, 4)
    .map((r) => ({ title: r.rule.title, message: r.result.message }));

  const authorName =
    matchedUser?.name ?? a.article.author?.trim() ?? "the author";
  const headline = a.sitemap.title || a.article.title || "(untitled)";

  const sent: Array<{
    name: string;
    chatId: string;
    forEditor: boolean;
    messageId: number;
  }> = [];
  const failed: Array<{ name: string; chatId: string; error: string }> = [];

  for (const r of byChat.values()) {
    try {
      const result = await sendTelegramMessage(
        r.chatId,
        buildAuthorAlert({
          authorName,
          headline,
          url: a.sitemap.url,
          editorialScore: a.editorialScore,
          topIssues,
          forEditor: r.forEditor,
          editorName: r.forEditor ? r.name : undefined,
        }),
      );
      sent.push({
        name: r.name,
        chatId: r.chatId,
        forEditor: r.forEditor,
        messageId: result.messageId,
      });
    } catch (err) {
      failed.push({
        name: r.name,
        chatId: r.chatId,
        error: (err as Error).message,
      });
    }
  }

  if (sent.length === 0) {
    return NextResponse.json(
      { ok: false, error: "All sends failed", failed },
      { status: 500 },
    );
  }

  // Friendly toast text for the UI: "Sent to Aman + 2 editors" etc.
  const authorSent = sent.find((s) => !s.forEditor);
  const editorCount = sent.filter((s) => s.forEditor).length;
  const summary = authorSent
    ? editorCount > 0
      ? `Sent to ${authorSent.name} + ${editorCount} editor${editorCount === 1 ? "" : "s"}`
      : `Sent to ${authorSent.name}`
    : `Sent to ${editorCount} editor${editorCount === 1 ? "" : "s"}`;

  return NextResponse.json({
    ok: true,
    summary,
    sent,
    failed,
  });
}

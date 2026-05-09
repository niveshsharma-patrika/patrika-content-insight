import { NextResponse } from "next/server";
import { getArticleAnalysisById } from "@/lib/analyze";
import { findUserForByline } from "@/lib/users";
import {
  buildAuthorAlert,
  isTelegramConfigured,
  sendTelegramMessage,
} from "@/lib/telegram";

export async function POST(req: Request) {
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
      { ok: false, error: "Telegram bot token not configured. Add it in Settings." },
      { status: 400 },
    );
  }

  const a = await getArticleAnalysisById(id);
  if (!a) {
    return NextResponse.json(
      { ok: false, error: "Article not found in sitemap" },
      { status: 404 },
    );
  }
  if (!a.article.ok) {
    return NextResponse.json(
      { ok: false, error: "Article fetch failed — cannot evaluate" },
      { status: 422 },
    );
  }

  const user = await findUserForByline(a.article.author);
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: a.article.author
          ? `No user mapping found for byline "${a.article.author}". Add the author in Settings.`
          : "Article has no detected byline.",
      },
      { status: 404 },
    );
  }
  if (!user.telegramChatId) {
    return NextResponse.json(
      {
        ok: false,
        error: `User "${user.name}" has no Telegram chat ID. Set it in Settings → Users.`,
      },
      { status: 400 },
    );
  }

  // Compose
  const topIssues = a.results
    .filter(
      (r) => !r.result.passed && r.rule.scope === "editorial",
    )
    .sort((x, y) =>
      (y.rule.severity === "error" ? 3 : y.rule.severity === "warning" ? 2 : 1) -
      (x.rule.severity === "error" ? 3 : x.rule.severity === "warning" ? 2 : 1),
    )
    .slice(0, 4)
    .map((r) => ({
      title: r.rule.title,
      message: r.result.message,
    }));

  const text = buildAuthorAlert({
    authorName: user.name,
    headline: a.sitemap.title || a.article.title || "(untitled)",
    url: a.sitemap.url,
    editorialScore: a.editorialScore,
    topIssues,
  });

  try {
    const r = await sendTelegramMessage(user.telegramChatId, text);
    return NextResponse.json({
      ok: true,
      sent: {
        userName: user.name,
        chatId: user.telegramChatId,
        messageId: r.messageId,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }
}

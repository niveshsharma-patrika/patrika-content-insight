import { getConfig } from "./config";

const API_BASE = "https://api.telegram.org";

export type BotInfo = {
  id: number;
  is_bot: boolean;
  username: string;
  first_name?: string;
  can_join_groups?: boolean;
};

async function bot(): Promise<{ token: string; base: string }> {
  const cfg = await getConfig();
  if (!cfg.telegramBotToken) throw new Error("Telegram bot token not configured");
  return { token: cfg.telegramBotToken, base: `${API_BASE}/bot${cfg.telegramBotToken}` };
}

export async function isTelegramConfigured(): Promise<boolean> {
  const cfg = await getConfig();
  return !!cfg.telegramBotToken;
}

/** GET getMe — used to validate that the saved token is still alive. */
export async function getBotInfo(): Promise<BotInfo> {
  const { base } = await bot();
  const r = await fetch(`${base}/getMe`, { method: "GET" });
  const data = (await r.json()) as { ok: boolean; result?: BotInfo; description?: string };
  if (!data.ok || !data.result)
    throw new Error(data.description ?? "getMe failed");
  return data.result;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts?: { parseMode?: "HTML" | "Markdown" | "MarkdownV2"; disableWebPagePreview?: boolean },
): Promise<{ messageId: number }> {
  const { base } = await bot();
  const r = await fetch(`${base}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: opts?.parseMode ?? "HTML",
      disable_web_page_preview: opts?.disableWebPagePreview ?? false,
    }),
  });
  const data = (await r.json()) as {
    ok: boolean;
    result?: { message_id: number };
    description?: string;
  };
  if (!data.ok || !data.result)
    throw new Error(data.description ?? "Telegram sendMessage failed");
  return { messageId: data.result.message_id };
}

/** Compose the editorial-review notification payload.
 *
 * Two variants depending on who the recipient is:
 *   • author    → "Hi {authorName}, your article scored …"
 *   • editor    → "Heads up — {authorName}'s article scored …"
 *
 * Both share the same body (headline, score, top issues, link) so a
 * forwarded message reads identically.
 */
export function buildAuthorAlert(input: {
  authorName: string;
  headline: string;
  url: string;
  editorialScore: number;
  topIssues: Array<{ title: string; message?: string }>;
  /** Whether this message is going to an editor (not the author). */
  forEditor?: boolean;
  /** The editor's display name, used in the greeting line. */
  editorName?: string;
}): string {
  const issues = input.topIssues
    .slice(0, 4)
    .map((i) => `• ${escape(i.message || i.title)}`)
    .join("\n");

  const greeting = input.forEditor
    ? input.editorName
      ? `Hi ${escape(input.editorName)} — heads up on a low-scoring article:`
      : `Heads up on a low-scoring article:`
    : `Hi ${escape(input.authorName)},`;

  const scoreLine = input.forEditor
    ? `<b>${escape(input.authorName)}</b>'s article scored <b>${input.editorialScore}%</b> on the Patrika editorial checklist (target ≥80%).`
    : `Your article scored <b>${input.editorialScore}%</b> on the Patrika editorial checklist (target ≥80%).`;

  const sign = input.forEditor
    ? `— Patrika Editorial Insight`
    : `Please review and refine when you can — Patrika Editorial Insight.`;

  return [
    `🔔 <b>Editorial review needed</b>`,
    "",
    greeting,
    "",
    scoreLine,
    "",
    `<b>Article:</b> ${escape(input.headline)}`,
    issues ? `\n<b>Top issues to fix:</b>\n${issues}` : "",
    "",
    `<a href="${escape(input.url)}">${escape(input.url)}</a>`,
    "",
    sign,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * SEO-failure alert. Separate from buildAuthorAlert because:
 *   • recipients are different (SEO ops, not the author or editorial editor),
 *   • top issues are tech/infra not editorial craft,
 *   • tone is "technical action item" not "please review your writing".
 *
 * Sent to editors who have the `'seo'` role when an article's
 * seoScore drops below 80.
 */
export function buildSeoAlert(input: {
  recipientName: string;
  headline: string;
  url: string;
  seoScore: number;
  topIssues: Array<{ title: string; message?: string }>;
}): string {
  const issues = input.topIssues
    .slice(0, 5)
    .map((i) => `• ${escape(i.message || i.title)}`)
    .join("\n");

  return [
    `🔧 <b>SEO issues detected</b>`,
    "",
    `Hi ${escape(input.recipientName)} — flagging an article that scored <b>${input.seoScore}%</b> on the SEO checklist (target ≥80%).`,
    "",
    `<b>Article:</b> ${escape(input.headline)}`,
    issues ? `\n<b>Top issues to fix:</b>\n${issues}` : "",
    "",
    `<a href="${escape(input.url)}">${escape(input.url)}</a>`,
    "",
    `— Patrika Editorial Insight`,
  ]
    .filter(Boolean)
    .join("\n");
}

function escape(s: string): string {
  // Telegram HTML mode supports <b>, <i>, <a>. Escape every char that
  // could break out of either text content OR an attribute value —
  // including " (used inside href="..."). Without escaping ", a
  // crafted URL or scraped headline could break message parsing and
  // silently fail the send.
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

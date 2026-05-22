"use client";

import { useState, useTransition } from "react";
import type { Editor, EditorRole } from "@/lib/editors";

/**
 * Settings → Editors panel.
 *
 * Editors are the people who get a Telegram nudge for *every* article
 * scoring below 80%, regardless of who wrote it. The list is small
 * (typically 1–5 senior editors) and entries are added by hand.
 */
export function EditorManager({
  initialEditors,
  telegramConfigured,
}: {
  initialEditors: Editor[];
  telegramConfigured: boolean;
}) {
  const [editors, setEditors] = useState<Editor[]>(initialEditors);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const r = await fetch("/api/editors");
    const data = await r.json();
    if (data.ok) setEditors(data.editors);
  }

  const activeCount = editors.filter((e) => e.active).length;
  const editorialCount = editors.filter(
    (e) => e.active && e.roles.includes("editorial"),
  ).length;
  const seoCount = editors.filter(
    (e) => e.active && e.roles.includes("seo"),
  ).length;

  return (
    <section
      className="rounded-xl border bg-card overflow-hidden"
      id="editors"
    >
      <header className="px-5 py-3 border-b bg-stone-50/60">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Editors</h2>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md bg-foreground text-background px-3 py-1 text-xs font-medium hover:bg-stone-800 whitespace-nowrap"
            >
              + Add editor
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted mt-1">
          Editors get Telegram nudges for low-scoring articles. Each editor
          picks one or both alert tracks:
          <br />
          <span className="inline-flex items-center gap-1 mt-1">
            <span className="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-medium">
              Editorial
            </span>{" "}
            fires when editorialScore &lt; 80 (headline, intro, alt text…)
          </span>
          <br />
          <span className="inline-flex items-center gap-1">
            <span className="rounded bg-sky-100 text-sky-900 px-1.5 py-0.5 text-[10px] font-medium">
              SEO
            </span>{" "}
            fires when seoScore &lt; 80 (canonical, redirects, TTFB, AMP…)
          </span>
          <br />
          <span className="mt-1 block">
            {activeCount} active · {editorialCount} editorial · {seoCount} seo
          </span>
          {!telegramConfigured ? (
            <span className="text-amber-700">
              The <span className="font-mono">TELEGRAM_BOT_TOKEN</span> env
              var isn&apos;t set, so messages won&apos;t deliver yet.
            </span>
          ) : null}
        </p>
      </header>

      {adding ? (
        <EditorForm
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : null}

      {editors.length === 0 && !adding ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No editors yet. Add one with their Telegram chat ID — they&apos;ll
          start receiving every low-score nudge from the next cron tick.
        </p>
      ) : (
        <ul className="divide-y">
          {editors.map((e) => (
            <li key={e.id}>
              {editing === e.id ? (
                <EditorForm
                  editor={e}
                  onCancel={() => setEditing(null)}
                  onSaved={async () => {
                    setEditing(null);
                    await refresh();
                  }}
                />
              ) : (
                <EditorRow
                  editor={e}
                  onEdit={() => setEditing(e.id)}
                  onDeleted={refresh}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditorRow({
  editor,
  onEdit,
  onDeleted,
}: {
  editor: Editor;
  onEdit: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function del() {
    if (!confirm(`Remove ${editor.name}? This cannot be undone.`)) return;
    startTransition(async () => {
      await fetch(`/api/editors/${editor.id}`, { method: "DELETE" });
      await onDeleted();
    });
  }

  function test() {
    setMsg(null);
    setError(null);
    startTransition(async () => {
      const r = await fetch("/api/telegram/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: editor.telegramChatId }),
      });
      const data = await r.json();
      if (data.ok) setMsg(`Test sent (msg ${data.messageId})`);
      else setError(data.error ?? "Failed");
    });
  }

  return (
    <div className="px-5 py-3 grid grid-cols-12 items-center gap-3">
      <div className="col-span-5 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
          <span
            className={`inline-block size-1.5 rounded-full ${
              editor.active ? "bg-emerald-500" : "bg-stone-300"
            }`}
          />
          {editor.name}
          {editor.roles.includes("editorial") ? (
            <span
              className="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-medium"
              title="Receives editorial nudges (editorialScore < 80)"
            >
              Editorial
            </span>
          ) : null}
          {editor.roles.includes("seo") ? (
            <span
              className="rounded bg-sky-100 text-sky-900 px-1.5 py-0.5 text-[10px] font-medium"
              title="Receives SEO nudges (seoScore < 80)"
            >
              SEO
            </span>
          ) : null}
        </div>
        {editor.notes ? (
          <div className="text-[11px] text-muted line-clamp-1 mt-0.5">
            {editor.notes}
          </div>
        ) : null}
      </div>
      <div className="col-span-4 text-xs">
        <div className="text-[10px] uppercase tracking-wide text-muted">
          Telegram
        </div>
        <div className="font-mono truncate">{editor.telegramChatId}</div>
      </div>
      <div className="col-span-3 flex items-center justify-end gap-3 text-xs">
        <button
          type="button"
          onClick={test}
          disabled={pending}
          className="text-muted hover:text-foreground disabled:opacity-60"
        >
          Test
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="text-muted hover:text-foreground"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={del}
          disabled={pending}
          className="text-red-700 hover:underline disabled:opacity-60"
        >
          Delete
        </button>
      </div>
      {msg || error ? (
        <div className="col-span-12 text-xs">
          {msg ? <span className="text-emerald-700">{msg}</span> : null}
          {error ? <span className="text-red-700">{error}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function EditorForm({
  editor,
  onCancel,
  onSaved,
}: {
  editor?: Editor;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(editor?.name ?? "");
  const [telegramChatId, setTelegramChatId] = useState(
    editor?.telegramChatId ?? "",
  );
  const [active, setActive] = useState(editor?.active ?? true);
  // New editors default to editorial-only (matches the pre-roles
  // behavior). Editing an existing editor starts from their saved set.
  const [rolesState, setRolesState] = useState<{
    editorial: boolean;
    seo: boolean;
  }>(() => ({
    editorial: editor ? editor.roles.includes("editorial") : true,
    seo: editor ? editor.roles.includes("seo") : false,
  }));
  const [notes, setNotes] = useState(editor?.notes ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // At least one role must be selected — saving with zero is meaningless
  // (editor receives nothing). UI enforces this by disabling Save.
  const noRoleSelected = !rolesState.editorial && !rolesState.seo;

  function save() {
    if (noRoleSelected) {
      setError("Select at least one alert track (Editorial or SEO).");
      return;
    }
    setError(null);
    const roles: EditorRole[] = [];
    if (rolesState.editorial) roles.push("editorial");
    if (rolesState.seo) roles.push("seo");
    startTransition(async () => {
      const r = await fetch("/api/editors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editor?.id,
          name,
          telegramChatId,
          active,
          roles,
          notes,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      await onSaved();
    });
  }

  return (
    <div className="px-5 py-4 bg-stone-50/40 space-y-3">
      <details className="text-xs text-muted bg-card border rounded-md px-3 py-2">
        <summary className="cursor-pointer font-medium text-foreground">
          How does the editor get their chat ID?
        </summary>
        <ol className="list-decimal pl-5 mt-2 space-y-1">
          <li>
            Open Telegram → search for{" "}
            <span className="font-mono">@patrika_ai_editor_bot</span> →
            click <span className="font-medium">Start</span> (or send any
            message). This grants the bot permission to DM the editor.
          </li>
          <li>
            Search for <span className="font-mono">@userinfobot</span> →
            send any message → it replies with the editor&apos;s numeric{" "}
            <span className="font-mono">Id</span>.
          </li>
          <li>Copy that numeric Id and paste it below.</li>
        </ol>
      </details>

      <div className="grid sm:grid-cols-2 gap-3">
      <Field label="Display name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Suresh Bhardwaj"
          className="w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
      </Field>
      <Field
        label="Telegram chat ID (numeric)"
        hint="Must be a number. @usernames and phone numbers don't work."
      >
        <input
          value={telegramChatId}
          onChange={(e) => setTelegramChatId(e.target.value)}
          placeholder="e.g. 123456789"
          className="w-full rounded-md border bg-card px-3 py-2 text-sm font-mono"
          inputMode="numeric"
          pattern="-?\d+"
        />
      </Field>
      <Field label="Notes (optional)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Beat / role — internal use only"
          className="w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Active — receives Telegram nudges
      </label>
      <fieldset className="sm:col-span-2 border rounded-md px-3 py-2 bg-card">
        <legend className="text-[10px] uppercase tracking-wider text-muted font-medium px-1">
          Alert tracks
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rolesState.editorial}
              onChange={(e) =>
                setRolesState((p) => ({ ...p, editorial: e.target.checked }))
              }
            />
            <span>
              <span className="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-medium mr-1">
                Editorial
              </span>
              editorialScore &lt; 80
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={rolesState.seo}
              onChange={(e) =>
                setRolesState((p) => ({ ...p, seo: e.target.checked }))
              }
            />
            <span>
              <span className="rounded bg-sky-100 text-sky-900 px-1.5 py-0.5 text-[10px] font-medium mr-1">
                SEO
              </span>
              seoScore &lt; 80
            </span>
          </label>
        </div>
        {noRoleSelected ? (
          <p className="text-[11px] text-amber-700 mt-1.5">
            Pick at least one — an editor with zero tracks won&apos;t
            receive anything.
          </p>
        ) : null}
      </fieldset>
      <div className="sm:col-span-2 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={
            pending ||
            !name.trim() ||
            !telegramChatId.trim() ||
            noRoleSelected
          }
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Saving…" : editor ? "Save changes" : "Add editor"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-stone-50"
        >
          Cancel
        </button>
        {error ? (
          <span className="text-sm text-red-700">{error}</span>
        ) : null}
      </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] uppercase tracking-wider text-muted font-medium">
        {label}
      </label>
      {children}
      {hint ? <span className="text-[10px] text-muted">{hint}</span> : null}
    </div>
  );
}

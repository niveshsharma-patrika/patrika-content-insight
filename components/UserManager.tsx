"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { User } from "@/lib/users";
import { Paginator } from "./Paginator";

const PER_PAGE = 10;

export function UserManager({
  initialUsers,
  telegramConfigured,
}: {
  initialUsers: User[];
  telegramConfigured: boolean;
}) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever the search filter changes — otherwise the
  // user can land on a "page 5" that no longer has any results.
  useEffect(() => {
    setPage(1);
  }, [query]);

  async function refresh() {
    const r = await fetch("/api/users");
    const data = await r.json();
    if (data.ok) setUsers(data.users);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.aliases.some((a) => a.toLowerCase().includes(q)) ||
        (u.telegramChatId ?? "").toLowerCase().includes(q),
    );
  }, [users, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PER_PAGE;
  const visible = filtered.slice(start, start + PER_PAGE);

  const missingChatId = users.filter(
    (u) => u.active && !u.telegramChatId,
  ).length;

  return (
    <section className="rounded-xl border bg-card overflow-hidden" id="users">
      <header className="px-5 py-3 border-b bg-stone-50/60">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Authors</h2>
          <span className="text-[11px] text-muted">
            {users.length} imported
            {missingChatId > 0 ? (
              <>
                {" · "}
                <span className="text-amber-700">
                  {missingChatId} missing Telegram chat ID
                </span>
              </>
            ) : null}
          </span>
        </div>
        <p className="text-xs text-muted mt-1">
          Bylines are imported automatically from each scraped article.
          Click <span className="font-medium">Edit</span> on a row to add
          their Telegram chat ID — that&apos;s what enables nudges when an
          article scores below 80%.
          {!telegramConfigured ? (
            <span className="text-amber-700">
              {" "}
              The <span className="font-mono">TELEGRAM_BOT_TOKEN</span> env
              var isn&apos;t set yet, so messages won&apos;t actually
              deliver until you configure it.
            </span>
          ) : null}
        </p>
      </header>

      {users.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No authors imported yet. They&apos;ll appear here as soon as the
          cron scrapes its first batch of articles.
        </p>
      ) : (
        <>
          <div className="px-5 py-2 border-b bg-stone-50/30">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter authors by name, alias, or chat ID…"
              className="w-full rounded-md border bg-card px-3 py-1.5 text-sm"
            />
          </div>
          {visible.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-muted">
              No authors match &ldquo;{query}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y">
              {visible.map((u) => (
                <li key={u.id}>
                  {editing === u.id ? (
                    <UserForm
                      user={u}
                      onCancel={() => setEditing(null)}
                      onSaved={async () => {
                        setEditing(null);
                        await refresh();
                      }}
                    />
                  ) : (
                    <UserRow
                      user={u}
                      onEdit={() => setEditing(u.id)}
                      onDeleted={refresh}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <Paginator
            page={safePage}
            pageCount={totalPages}
            total={filtered.length}
            perPage={PER_PAGE}
            onPage={setPage}
          />
        </>
      )}
    </section>
  );
}

function UserRow({
  user,
  onEdit,
  onDeleted,
}: {
  user: User;
  onEdit: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function del() {
    if (!confirm(`Remove ${user.name}? This cannot be undone.`)) return;
    startTransition(async () => {
      await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      await onDeleted();
    });
  }

  function test() {
    if (!user.telegramChatId) return;
    setMsg(null);
    setError(null);
    startTransition(async () => {
      const r = await fetch("/api/telegram/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chatId: user.telegramChatId }),
      });
      const data = await r.json();
      if (data.ok) setMsg(`Test sent (msg ${data.messageId})`);
      else setError(data.error ?? "Failed");
    });
  }

  return (
    <div className="px-5 py-3 grid grid-cols-12 items-center gap-3">
      <div className="col-span-4 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2">
          <span
            className={`inline-block size-1.5 rounded-full ${
              user.active ? "bg-emerald-500" : "bg-stone-300"
            }`}
          />
          {user.name}
        </div>
        {user.notes ? (
          <div className="text-[11px] text-muted line-clamp-1 mt-0.5">
            {user.notes}
          </div>
        ) : null}
      </div>
      <div className="col-span-3 text-xs text-muted truncate">
        <div className="text-[10px] uppercase tracking-wide">Aliases</div>
        <div className="truncate">{user.aliases.join(", ") || "—"}</div>
      </div>
      <div className="col-span-3 text-xs">
        <div className="text-[10px] uppercase tracking-wide text-muted">
          Telegram
        </div>
        <div className="font-mono">
          {user.telegramChatId ? (
            user.telegramChatId
          ) : (
            <span className="text-amber-700">not set</span>
          )}
        </div>
      </div>
      <div className="col-span-2 flex items-center justify-end gap-2 text-xs">
        {user.telegramChatId ? (
          <button
            type="button"
            onClick={test}
            disabled={pending}
            className="text-muted hover:text-foreground disabled:opacity-60"
          >
            Test
          </button>
        ) : null}
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

function UserForm({
  user,
  onCancel,
  onSaved,
}: {
  user?: User;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [aliases, setAliases] = useState((user?.aliases ?? []).join(", "));
  const [telegramChatId, setTelegramChatId] = useState(
    user?.telegramChatId ?? "",
  );
  const [active, setActive] = useState(user?.active ?? true);
  const [notes, setNotes] = useState(user?.notes ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: user?.id,
          name,
          aliases,
          telegramChatId,
          active,
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
    <div className="px-5 py-4 bg-stone-50/40 grid sm:grid-cols-2 gap-3">
      <Field label="Display name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nivesh Sharma"
          className="w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
      </Field>
      <Field
        label="Telegram chat ID"
        hint="DM @userinfobot on Telegram to find a chat ID; paste the numeric value here."
      >
        <input
          value={telegramChatId}
          onChange={(e) => setTelegramChatId(e.target.value)}
          placeholder="e.g. 123456789"
          className="w-full rounded-md border bg-card px-3 py-2 text-sm font-mono"
        />
      </Field>
      <Field
        label="Aliases"
        hint="Comma-separated names that appear as bylines on Patrika.com. Match is case-insensitive substring."
      >
        <input
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="Nivesh Sharma, Nivesh, N. Sharma"
          className="w-full rounded-md border bg-card px-3 py-2 text-sm"
        />
      </Field>
      <Field label="Notes (optional)">
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Beat / desk / phone — internal use only"
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
      <div className="sm:col-span-2 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !name.trim()}
          className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-60"
        >
          {pending ? "Saving…" : user ? "Save changes" : "Add user"}
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

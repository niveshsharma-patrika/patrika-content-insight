"use client";

import { useState, useTransition } from "react";
import type { Role } from "@/lib/auth";

export type LoginUser = {
  id: string;
  username: string;
  role: Role;
  active: boolean;
  createdAt: string;
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_HELP: Record<Role, string> = {
  admin: "Full access, including managing these login users.",
  editor: "Manage authors/sections/editors, toggle rules, send notifications.",
  viewer: "Read-only — can view the dashboard but change nothing.",
};

/**
 * Settings → Login users panel (admin-only). Create/edit/deactivate the
 * people who can log into the dashboard and set their permission tier.
 * Separate from Authors (article bylines) and Editors (Telegram
 * recipients). The env DASHBOARD_USERNAME stays a built-in super-admin.
 */
export function LoginUserManager({
  initialUsers,
  currentUser,
}: {
  initialUsers: LoginUser[];
  currentUser: string;
}) {
  const [users, setUsers] = useState<LoginUser[]>(initialUsers);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/auth-users");
    const data = await r.json();
    if (data.ok) setUsers(data.users);
  }

  return (
    <section className="rounded-xl border bg-card overflow-hidden" id="login-users">
      <header className="px-5 py-3 border-b bg-stone-50/60">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Login users</h2>
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md bg-foreground text-background px-3 py-1 text-xs font-medium hover:bg-stone-800 whitespace-nowrap"
            >
              + Add user
            </button>
          ) : null}
        </div>
        <p className="text-xs text-muted mt-1">
          People who can sign in, each with a permission tier:{" "}
          <span className="font-medium">Admin</span> (full + user management),{" "}
          <span className="font-medium">Editor</span> (manage data, toggle
          rules, notify), <span className="font-medium">Viewer</span>{" "}
          (read-only). The built-in{" "}
          <span className="font-mono">DASHBOARD_USERNAME</span> env login is
          always an admin and can&apos;t be removed here.
        </p>
      </header>

      {adding ? (
        <UserForm
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : null}

      {users.length === 0 && !adding ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          No login users yet. You&apos;re signed in via the env break-glass
          admin. Add teammates here with their own usernames + tiers.
        </p>
      ) : (
        <ul className="divide-y">
          {users.map((u) => (
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
                  isSelf={u.username === currentUser}
                  onEdit={() => setEditing(u.id)}
                  onChanged={refresh}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const cls =
    role === "admin"
      ? "bg-red-100 text-red-900"
      : role === "editor"
        ? "bg-amber-100 text-amber-900"
        : "bg-stone-100 text-stone-700";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
      title={ROLE_HELP[role]}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

function UserRow({
  user,
  isSelf,
  onEdit,
  onChanged,
}: {
  user: LoginUser;
  isSelf: boolean;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();

  function del() {
    if (!confirm(`Remove login user "${user.username}"? This cannot be undone.`))
      return;
    startTransition(async () => {
      await fetch(`/api/auth-users/${user.id}`, { method: "DELETE" });
      await onChanged();
    });
  }

  return (
    <div className="px-5 py-3 grid grid-cols-12 items-center gap-3">
      <div className="col-span-6 min-w-0">
        <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
          <span
            className={`inline-block size-1.5 rounded-full ${
              user.active ? "bg-emerald-500" : "bg-stone-300"
            }`}
          />
          {user.username}
          {isSelf ? (
            <span className="text-[10px] text-muted">(you)</span>
          ) : null}
          <RoleBadge role={user.role} />
          {!user.active ? (
            <span className="text-[10px] text-stone-500">disabled</span>
          ) : null}
        </div>
      </div>
      <div className="col-span-6 flex items-center justify-end gap-3 text-xs">
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
    </div>
  );
}

function UserForm({
  user,
  onCancel,
  onSaved,
}: {
  user?: LoginUser;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(user?.role ?? "viewer");
  const [active, setActive] = useState(user?.active ?? true);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    const body: Record<string, unknown> = isEdit
      ? { id: user!.id, role, active }
      : { username, password, role };
    if (isEdit && password) body.password = password;
    startTransition(async () => {
      const r = await fetch("/api/auth-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Username">
          <input
            autoFocus={!isEdit}
            value={username}
            disabled={isEdit}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. priya"
            className="w-full rounded-md border bg-card px-3 py-2 text-sm disabled:bg-stone-100 disabled:text-muted"
          />
        </Field>
        <Field
          label={isEdit ? "Reset password (optional)" : "Password"}
          hint="At least 8 characters."
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? "Leave blank to keep current" : "********"}
            className="w-full rounded-md border bg-card px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Permission tier">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-md border bg-card px-3 py-2 text-sm"
          >
            <option value="admin">Admin — full access + user management</option>
            <option value="editor">Editor — manage data, rules, notify</option>
            <option value="viewer">Viewer — read-only</option>
          </select>
        </Field>
        {isEdit ? (
          <label className="flex items-center gap-2 text-sm self-end pb-2">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active — can sign in
          </label>
        ) : null}
        <p className="sm:col-span-2 text-[11px] text-muted">{ROLE_HELP[role]}</p>
        <div className="sm:col-span-2 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={
              pending ||
              (!isEdit && (!username.trim() || password.length < 8))
            }
            className="rounded-md bg-foreground text-background px-3 py-1.5 text-sm font-medium disabled:opacity-60"
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Add user"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-stone-50"
          >
            Cancel
          </button>
          {error ? <span className="text-sm text-red-700">{error}</span> : null}
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

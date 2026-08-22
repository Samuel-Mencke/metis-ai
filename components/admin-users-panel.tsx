"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Shield, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";

type AdminUser = {
  id: string;
  username: string;
  createdAt: string;
  isAdmin: boolean;
  workspaceRoot: string;
  osUsername?: string;
};

type OsUser = {
  username: string;
  uid: number;
  gid: number;
  home: string;
};

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

function LinuxUserField({
  value,
  onChange,
  osUsers,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  osUsers: OsUser[];
  ariaLabel: string;
}) {
  if (osUsers.length === 0) {
    return (
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Linux user (must exist on host)"
        aria-label={ariaLabel}
        className="h-8 font-normal"
        autoComplete="off"
      />
    );
  }
  const options = osUsers.some((user) => user.username === value) || !value
    ? osUsers
    : [{ username: value, uid: -1, gid: -1, home: "" }, ...osUsers];
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={selectClassName}
    >
      <option value="">None</option>
      {options.map((user) => (
        <option key={user.username} value={user.username}>
          {user.uid > 0 ? `${user.username} · uid ${user.uid}` : user.username}
        </option>
      ))}
    </select>
  );
}

export function AdminUsersPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [osUsers, setOsUsers] = useState<OsUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [osUsername, setOsUsername] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [passwordEdits, setPasswordEdits] = useState<Record<string, string>>({});
  const [workspaceEdits, setWorkspaceEdits] = useState<Record<string, string>>({});
  const [osEdits, setOsEdits] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usersResponse, osResponse] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/os-users", { cache: "no-store" }),
      ]);
      const usersBody = await usersResponse.json().catch(() => ({})) as { users?: AdminUser[]; error?: string };
      if (!usersResponse.ok) throw new Error(usersBody.error || "Could not load users.");
      setUsers(usersBody.users || []);
      if (osResponse.ok) {
        const osBody = await osResponse.json().catch(() => ({})) as { users?: OsUser[] };
        setOsUsers(osBody.users || []);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function selectCreateOsUser(next: string) {
    setOsUsername(next);
    const home = osUsers.find((user) => user.username === next)?.home?.trim();
    if (home && !workspaceRoot.trim()) setWorkspaceRoot(home);
  }

  async function createUser() {
    setBusy(true);
    try {
      const selected = osUsers.find((user) => user.username === osUsername.trim());
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          workspaceRoot: workspaceRoot.trim() || selected?.home || undefined,
          osUsername: osUsername.trim() || undefined,
          isAdmin: makeAdmin,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not create user.");
      setUsername("");
      setPassword("");
      setWorkspaceRoot("");
      setOsUsername("");
      setMakeAdmin(false);
      toast.success("User created");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create user.");
    } finally {
      setBusy(false);
    }
  }

  async function saveWorkspace(user: AdminUser) {
    const next = (workspaceEdits[user.id] ?? user.workspaceRoot).trim();
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceRoot: next }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update workspace.");
      toast.success("Workspace updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function saveOsUser(user: AdminUser) {
    const next = (osEdits[user.id] ?? user.osUsername ?? "").trim();
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ osUsername: next || null }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update Linux user.");
      toast.success("Linux user updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update Linux user.");
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(user: AdminUser) {
    const next = passwordEdits[user.id] || "";
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: next }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update password.");
      setPasswordEdits((current) => ({ ...current, [user.id]: "" }));
      toast.success("Password updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin(user: AdminUser) {
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: !user.isAdmin }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not update admin flag.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update admin flag.");
    } finally {
      setBusy(false);
    }
  }

  async function removeUser() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not delete user.");
      toast.success("User deleted");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete user.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Users className="size-4" />
            Users
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Admins can create accounts, assign a Linux user, set workspace folders, and promote other admins.
          </p>
        </div>
        <Button type="button" size="xs" variant="ghost" onClick={() => void load()} disabled={loading}>
          <RefreshCw className="size-3.5" />
          Reload
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border border-border/60 p-4">
        <p className="text-sm font-medium">Create user</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" aria-label="New username" />
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password (min 8)" aria-label="New password" />
        </div>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
          Linux user
          <LinuxUserField
            value={osUsername}
            onChange={selectCreateOsUser}
            osUsers={osUsers}
            ariaLabel="New Linux user"
          />
        </label>
        <Input
          value={workspaceRoot}
          onChange={(event) => setWorkspaceRoot(event.target.value)}
          placeholder="Workspace path (absolute)"
          aria-label="New workspace path"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant={makeAdmin ? "secondary" : "outline"} onClick={() => setMakeAdmin((current) => !current)}>
            <Shield className="size-3.5" />
            Admin: {makeAdmin ? "On" : "Off"}
          </Button>
          <Button type="button" size="sm" disabled={busy || username.trim().length < 3 || password.length < 8} onClick={() => void createUser()}>
            <Plus className="size-3.5" />
            Create
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading users…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {users.map((user) => (
            <article key={user.id} className="space-y-3 rounded-lg border border-border/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{user.username}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {user.isAdmin ? "Admin" : "User"}
                    {user.osUsername ? ` · ${user.osUsername}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button type="button" size="xs" variant={user.isAdmin ? "secondary" : "outline"} disabled={busy} onClick={() => void toggleAdmin(user)}>
                    Admin: {user.isAdmin ? "On" : "Off"}
                  </Button>
                  <Button type="button" size="icon-xs" variant="ghost" aria-label={`Delete ${user.username}`} onClick={() => setDeleteTarget(user)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                Linux user
                <div className="flex gap-1">
                  <LinuxUserField
                    value={osEdits[user.id] ?? user.osUsername ?? ""}
                    onChange={(value) => setOsEdits((current) => ({ ...current, [user.id]: value }))}
                    osUsers={osUsers}
                    ariaLabel={`${user.username} Linux user`}
                  />
                  <Button type="button" size="xs" disabled={busy} onClick={() => void saveOsUser(user)}>Save</Button>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                Workspace
                <div className="flex gap-1">
                  <Input
                    value={workspaceEdits[user.id] ?? user.workspaceRoot}
                    onChange={(event) => setWorkspaceEdits((current) => ({ ...current, [user.id]: event.target.value }))}
                    aria-label={`${user.username} workspace`}
                    className="h-8 font-normal"
                  />
                  <Button type="button" size="xs" disabled={busy} onClick={() => void saveWorkspace(user)}>Save</Button>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
                Set password
                <div className="flex gap-1">
                  <Input
                    type="password"
                    value={passwordEdits[user.id] || ""}
                    onChange={(event) => setPasswordEdits((current) => ({ ...current, [user.id]: event.target.value }))}
                    aria-label={`${user.username} new password`}
                    className="h-8 font-normal"
                    placeholder="New password"
                  />
                  <Button type="button" size="xs" disabled={busy || (passwordEdits[user.id] || "").length < 8} onClick={() => void savePassword(user)}>Set</Button>
                </div>
              </label>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete user?"
        description={`Delete ${deleteTarget?.username || "this user"}? Their chats and data for this account will be removed.`}
        confirmLabel="Delete"
        onConfirm={() => removeUser()}
      />
    </section>
  );
}

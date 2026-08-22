import path from "node:path";
import { readFileSync } from "node:fs";
import { getDatabase } from "@/lib/sqlite";
import { config } from "@/lib/config";
import {
  assertExecutionUid,
  isHostAdminUsername,
  isInsideWorkspace,
  isRootWorkspace,
  listAssignablePosixUsers,
  parsePasswdLine,
  type PosixIdentity,
} from "@/lib/user-isolation";

export type UserAccess = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
  home?: string;
};

export type UserExecutionIdentity = {
  username: string;
  uid: number;
  gid: number;
  home?: string;
  workspaceRoot: string;
};

type AccessRow = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
};

type UserRow = {
  id: string;
  username: string;
  isAdmin?: number;
};

export function lookupPosixUser(username: string): PosixIdentity | undefined {
  try {
    const line = readFileSync("/etc/passwd", "utf8").split("\n").find((entry) =>
      entry.split(":")[0]?.toLowerCase() === username.toLowerCase());
    return line ? parsePasswdLine(line) : undefined;
  } catch {
    return undefined;
  }
}

export function listHostOsUsers() {
  try {
    return listAssignablePosixUsers(readFileSync("/etc/passwd", "utf8"), {
      includeRoot: config.allowRootAgents,
    });
  } catch {
    return [];
  }
}

export function getUserAccess(userId?: string): UserAccess {
  if (!userId?.trim()) return { userId: "", workspaceRoot: path.resolve(config.agentCwd) };
  const row = getDatabase().prepare(
    `SELECT user_id AS userId, workspace_root AS workspaceRoot,
            os_username AS osUsername, uid, gid
     FROM user_workspace_access WHERE user_id = ?`,
  ).get(userId.trim()) as AccessRow | undefined;
  if (row?.workspaceRoot) {
    const posix = row.osUsername ? lookupPosixUser(row.osUsername) : undefined;
    return {
      ...row,
      workspaceRoot: path.resolve(row.workspaceRoot),
      ...(typeof row.uid === "number" ? { uid: row.uid } : posix ? { uid: posix.uid } : {}),
      ...(typeof row.gid === "number" ? { gid: row.gid } : posix ? { gid: posix.gid } : {}),
      ...(posix?.home ? { home: posix.home } : {}),
    };
  }
  return { userId: userId.trim(), workspaceRoot: path.resolve(config.agentCwd) };
}

export function getUserExecutionIdentity(userId?: string): UserExecutionIdentity | undefined {
  const access = getUserAccess(userId);
  if (!access.osUsername && config.allowRootAgents && isRootWorkspace(access.workspaceRoot)) {
    return {
      username: "root",
      uid: 0,
      gid: 0,
      home: "/root",
      workspaceRoot: access.workspaceRoot,
    };
  }
  if (!access.osUsername) return undefined;
  const posix = lookupPosixUser(access.osUsername);
  const uid = access.uid ?? posix?.uid;
  const gid = access.gid ?? posix?.gid;
  if (uid === 0 && config.allowRootAgents && isRootWorkspace(access.workspaceRoot, posix?.home || access.home)) {
    return {
      username: access.osUsername,
      uid,
      gid: gid ?? 0,
      home: posix?.home || access.home,
      workspaceRoot: access.workspaceRoot,
    };
  }
  if (uid === undefined || gid === undefined || uid <= 0) return undefined;
  return {
    username: access.osUsername,
    uid,
    gid,
    home: posix?.home || access.home,
    workspaceRoot: access.workspaceRoot,
  };
}

export function requireUserExecutionIdentity(userId?: string): UserExecutionIdentity {
  if (config.docker) {
    const access = getUserAccess(userId);
    return {
      username: process.env.USER?.trim() || "metis",
      uid: process.getuid?.() ?? 1000,
      gid: process.getgid?.() ?? 1000,
      home: process.env.HOME || config.dockerWorkspace,
      workspaceRoot: access.workspaceRoot,
    };
  }
  const account = userId
    ? getDatabase().prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username?: string } | undefined
    : undefined;
  if (account?.username) {
    provisionMissingAccountAccess(userId!, account.username);
  }
  const identity = getUserExecutionIdentity(userId);
  if (!identity) {
    throw new Error("This account has no valid OS user mapping. Provision a workspace with scripts/provision-user.ts.");
  }
  assertExecutionUid(identity.uid, {
    allowRoot: config.allowRootAgents,
    workspaceRoot: identity.workspaceRoot,
    home: identity.home,
  });
  return identity;
}

export function adminUserCount() {
  return Number(
    (getDatabase().prepare("SELECT COUNT(*) as count FROM users WHERE is_admin = 1").get() as { count: number }).count,
  );
}

export function isHostAdmin(userId?: string | null) {
  if (!userId?.trim()) return false;
  const user = getDatabase().prepare(
    "SELECT id, username, is_admin AS isAdmin FROM users WHERE id = ?",
  ).get(userId.trim()) as UserRow | undefined;
  if (!user?.username) return false;
  if (Number(user.isAdmin) === 1) return true;
  if (isHostAdminUsername(user.username, process.env)) return true;
  const first = getDatabase().prepare(
    "SELECT username FROM users ORDER BY created_at ASC LIMIT 1",
  ).get() as { username?: string } | undefined;
  return isHostAdminUsername(user.username, {}, first?.username);
}

export function resolveManagedWorkspaceRoot(workspaceRoot?: string | null) {
  const resolved = path.resolve((workspaceRoot || "").trim() || config.agentCwd);
  if (!path.isAbsolute(resolved) || resolved === path.sep) {
    throw new Error("Workspace path must be an absolute directory.");
  }
  if (config.docker && !isInsideWorkspace(config.dockerWorkspace, resolved)) {
    throw new Error(`Docker workspaces must be inside ${config.dockerWorkspace}.`);
  }
  return resolved;
}

export function ensureUserAccess(
  userId: string,
  workspaceRoot: string,
  osUsername?: string,
) {
  const identity = osUsername ? lookupPosixUser(osUsername) : undefined;
  if (osUsername && !identity) {
    throw new Error(`OS user ${osUsername} does not exist on this host.`);
  }
  if (identity) {
    assertExecutionUid(identity.uid, {
      allowRoot: config.allowRootAgents,
      workspaceRoot,
      home: identity.home,
    });
  }
  getDatabase().prepare(
    `INSERT INTO user_workspace_access
       (user_id, workspace_root, os_username, uid, gid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       workspace_root = excluded.workspace_root,
       os_username = excluded.os_username,
       uid = excluded.uid,
       gid = excluded.gid,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    path.resolve(workspaceRoot),
    osUsername ?? null,
    identity?.uid ?? null,
    identity?.gid ?? null,
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

export function provisionAccountAccess(userId: string, username: string) {
  const posix = lookupPosixUser(username);
  if (!posix || posix.uid <= 0) return false;
  const workspace = posix.home && posix.home !== "/" && posix.home !== "/root"
    ? posix.home
    : path.join("/home", username);
  ensureUserAccess(userId, workspace, username);
  return true;
}

/**
 * Repairs access created by older account flows without requiring a shell
 * command. Root is only selected for an explicitly allowed /root workspace;
 * otherwise an identically named non-root OS account is used when available.
 */
export function provisionMissingAccountAccess(userId: string, username: string) {
  const access = getUserAccess(userId);
  const current = access.osUsername ? lookupPosixUser(access.osUsername) : undefined;
  if (current && (current.uid > 0 || (config.allowRootAgents && isRootWorkspace(access.workspaceRoot, current.home)))) {
    return true;
  }

  if (config.allowRootAgents && isRootWorkspace(access.workspaceRoot)) {
    ensureUserAccess(userId, access.workspaceRoot, "root");
    return true;
  }

  const matching = lookupPosixUser(username);
  if (matching && matching.uid > 0) {
    ensureUserAccess(userId, access.workspaceRoot, matching.username);
    return true;
  }
  return false;
}

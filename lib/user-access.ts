import path from "node:path";
import { readFileSync } from "node:fs";
import { getDatabase } from "@/lib/sqlite";
import { config } from "@/lib/config";

export type UserAccess = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
};

type AccessRow = {
  userId: string;
  workspaceRoot: string;
  osUsername?: string;
  uid?: number;
  gid?: number;
};

function lookupPosixUser(username: string) {
  try {
    const line = readFileSync("/etc/passwd", "utf8").split("\n").find((entry) =>
      entry.split(":")[0]?.toLowerCase() === username.toLowerCase());
    const fields = line?.split(":");
    const uid = Number(fields?.[2]);
    const gid = Number(fields?.[3]);
    if (Number.isInteger(uid) && Number.isInteger(gid)) {
      return { uid, gid };
    }
  } catch {
    // The requested account may not exist on this host.
  }
  return undefined;
}

export function getUserAccess(userId?: string): UserAccess {
  if (!userId?.trim()) return { userId: "", workspaceRoot: path.resolve(config.agentCwd) };
  const row = getDatabase().prepare(
    `SELECT user_id AS userId, workspace_root AS workspaceRoot,
            os_username AS osUsername, uid, gid
     FROM user_workspace_access WHERE user_id = ?`,
  ).get(userId.trim()) as AccessRow | undefined;
  if (row?.workspaceRoot) {
    return {
      ...row,
      workspaceRoot: path.resolve(row.workspaceRoot),
      ...(typeof row.uid === "number" ? { uid: row.uid } : {}),
      ...(typeof row.gid === "number" ? { gid: row.gid } : {}),
    };
  }
  return { userId: userId.trim(), workspaceRoot: path.resolve(config.agentCwd) };
}

export function getUserExecutionIdentity(userId?: string) {
  const access = getUserAccess(userId);
  if (!access.osUsername) return undefined;
  const posix = lookupPosixUser(access.osUsername);
  const uid = access.uid ?? posix?.uid;
  const gid = access.gid ?? posix?.gid;
  if (uid === undefined || gid === undefined || uid === process.getuid?.()) return undefined;
  return { username: access.osUsername, uid, gid };
}

export function ensureUserAccess(
  userId: string,
  workspaceRoot: string,
  osUsername?: string,
) {
  const identity = osUsername ? lookupPosixUser(osUsername) : undefined;
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

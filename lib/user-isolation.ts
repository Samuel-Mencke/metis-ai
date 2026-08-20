import path from "node:path";

export type PosixIdentity = {
  username: string;
  uid: number;
  gid: number;
  home: string;
};

export function isInsideWorkspace(root: string, candidate: string) {
  if (!root?.trim()) return false;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function isRootWorkspace(workspaceRoot: string, home = "/root") {
  const root = path.resolve(home || "/root");
  const workspace = path.resolve(workspaceRoot);
  return workspace === root || workspace.startsWith(`${root}${path.sep}`);
}

export function parsePasswdLine(line: string): PosixIdentity | undefined {
  const fields = line.split(":");
  if (fields.length < 6) return undefined;
  const username = fields[0]?.trim();
  const uid = Number(fields[2]);
  const gid = Number(fields[3]);
  const home = fields[5]?.trim() || "";
  if (!username || !Number.isInteger(uid) || !Number.isInteger(gid)) return undefined;
  return { username, uid, gid, home };
}

export function hostAdminUsernames(env: Record<string, string | undefined> = process.env) {
  const raw = env.METIS_AI_ADMIN_USERNAMES || env.CHAT_USERNAME || "";
  return raw.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function isHostAdminUsername(
  username: string,
  env: Record<string, string | undefined> = process.env,
  firstUsername?: string,
) {
  const normalized = username.trim().toLowerCase();
  if (!normalized) return false;
  if (hostAdminUsernames(env).includes(normalized)) return true;
  return Boolean(firstUsername && normalized === firstUsername.trim().toLowerCase());
}

export function assertNonRootUid(uid: number | undefined) {
  if (!Number.isInteger(uid) || Number(uid) <= 0) {
    throw new Error("Agent execution must use a non-root OS user.");
  }
}

export function assertExecutionUid(
  uid: number | undefined,
  options: { allowRoot?: boolean; workspaceRoot?: string; home?: string } = {},
) {
  if (uid === 0 && options.allowRoot && isRootWorkspace(options.workspaceRoot || "", options.home)) return;
  if (!Number.isInteger(uid) || Number(uid) < 0) {
    throw new Error("Agent execution requires a valid OS user.");
  }
  if (uid === 0) {
    throw new Error("Root agent execution is disabled unless explicitly configured for a /root workspace.");
  }
}

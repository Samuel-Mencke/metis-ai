import { readFileSync } from "node:fs";
import { createUser } from "../lib/auth";
import { ensureUserAccess } from "../lib/user-access";
import { getDatabase } from "../lib/sqlite";

const username = process.argv[2]?.trim();
const workspaceRoot = process.argv[3]?.trim();
const password = readFileSync(0, "utf8").trimEnd();
if (!username || !workspaceRoot || !password) {
  throw new Error("Usage: provision-user <username> <workspace-root> (password on stdin)");
}

const existing = getDatabase().prepare("SELECT id FROM users WHERE username = ?").get(username) as { id?: string } | undefined;
const user = existing?.id
  ? { id: existing.id }
  : createUser(username, password);
ensureUserAccess(user.id, workspaceRoot, username);
console.log(`Provisioned ${username} with workspace access at ${workspaceRoot}.`);

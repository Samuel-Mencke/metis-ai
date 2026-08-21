import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), `metis-admin-${randomUUID()}`));
process.env.CHAT_DATA_DIR = dir;
process.env.CHAT_DB_PATH = path.join(dir, "chat.sqlite");
process.env.AGENT_CWD = dir;
process.env.AI_CHAT_ROOT = dir;
delete process.env.CHAT_PASSWORD;
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;
delete process.env.METIS_AI_ADMIN_USERNAMES;

test("first created user is admin and later users are not", async () => {
  const { createManagedUser, deleteManagedUser, listAdminUsers, patchManagedUser } = await import("../lib/admin-users");
  const { isHostAdmin } = await import("../lib/user-access");
  const admin = createManagedUser({ username: "adminone", password: "password1", workspaceRoot: dir });
  assert.equal(admin.isAdmin, true);
  assert.equal(isHostAdmin(admin.id), true);
  assert.equal(listAdminUsers()[0].workspaceRoot, path.resolve(dir));
  const user = createManagedUser({ username: "normaluser", password: "password1", workspaceRoot: dir });
  assert.equal(user.isAdmin, false);
  assert.equal(isHostAdmin(user.id), false);
  assert.throws(() => patchManagedUser(admin.id, { isAdmin: false }), /last admin/);
  assert.throws(() => deleteManagedUser(admin.id, user.id), /last admin/);
  assert.throws(() => deleteManagedUser(user.id, user.id), /own account/);
});

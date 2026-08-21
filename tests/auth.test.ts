import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-auth-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.CHAT_PASSWORD = "shared-migration-password";
process.env.CHAT_USERNAME = "first-user";
delete process.env.METIS_AI_BOOTSTRAP_PASSWORD;

test("legacy header authentication requires an explicit existing username", async () => {
  const { createUser, getAuthenticatedUser, isAuthenticated } = await import("../lib/auth");
  const first = createUser("first-user-created", "password-one");
  const second = createUser("second-user-created", "password-two");

  const missingUsername = new Request("http://localhost", {
    headers: { "x-chat-password": "shared-migration-password" },
  });
  assert.equal(await getAuthenticatedUser(missingUsername), null);
  assert.equal(await isAuthenticated(missingUsername), false);

  const unknownUsername = new Request("http://localhost", {
    headers: {
      "x-chat-password": "shared-migration-password",
      "x-chat-username": "does-not-exist",
    },
  });
  assert.equal(await getAuthenticatedUser(unknownUsername), null);

  const explicitUsername = new Request("http://localhost", {
    headers: {
      "x-chat-password": "shared-migration-password",
      "x-chat-username": second.username,
    },
  });
  assert.equal((await getAuthenticatedUser(explicitUsername))?.id, second.id);
  assert.equal((await getAuthenticatedUser(explicitUsername))?.id === first.id, false);
  assert.equal(await isAuthenticated(explicitUsername), true);
});

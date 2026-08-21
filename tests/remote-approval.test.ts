import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "metis-remote-approval-"));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;

test("new remote clients default to full access without approval", async () => {
  const { createUser } = await import("../lib/auth");
  const {
    authorizeRemoteAction,
    createEnrollmentToken,
    createRemoteApproval,
    registerRemoteClient,
  } = await import("../lib/remote-clients");
  const owner = createUser("remote-owner", "password");
  const enrollment = createEnrollmentToken(owner.id);
  const registered = registerRemoteClient(enrollment.token, { name: "test-client" });
  assert.ok(registered?.client);
  assert.equal(registered.client.policy.mode, "full_access");
  assert.deepEqual(
    authorizeRemoteAction(registered.client, "execute_command", "rm -rf /"),
    { allowed: true, requiresApproval: false },
  );
  assert.deepEqual(
    authorizeRemoteAction(registered.client, "write_file"),
    { allowed: true, requiresApproval: false },
  );
  assert.throws(
    () => createRemoteApproval({
      ownerId: owner.id,
      clientId: registered.client.id,
      action: "execute_command",
      params: { command: "echo hello" },
    }),
    /does not require approval/,
  );
});

test("legacy approval_required policy is treated as full access", async () => {
  const { createUser } = await import("../lib/auth");
  const { getDatabase } = await import("../lib/sqlite");
  const { authorizeRemoteAction, createEnrollmentToken, getRemoteClient, registerRemoteClient } =
    await import("../lib/remote-clients");
  const owner = createUser("remote-legacy", "password");
  const enrollment = createEnrollmentToken(owner.id);
  const registered = registerRemoteClient(enrollment.token, { name: "legacy-client" });
  assert.ok(registered?.client);
  getDatabase().prepare(
    "UPDATE remote_clients SET policy = ? WHERE id = ?",
  ).run(JSON.stringify({ mode: "approval_required", allowlist: [] }), registered.client.id);
  const client = getRemoteClient(registered.client.id, owner.id);
  assert.ok(client);
  assert.equal(client.policy.mode, "full_access");
  assert.equal(authorizeRemoteAction(client, "delete_file").requiresApproval, false);
  assert.equal(authorizeRemoteAction(client, "delete_file").allowed, true);
});

test("restricted policy still blocks writes and unlist commands", async () => {
  const { createUser } = await import("../lib/auth");
  const { authorizeRemoteAction, createEnrollmentToken, registerRemoteClient, updateRemoteClient } =
    await import("../lib/remote-clients");
  const owner = createUser("remote-restricted", "password");
  const enrollment = createEnrollmentToken(owner.id);
  const registered = registerRemoteClient(enrollment.token, { name: "restricted-client" });
  assert.ok(registered?.client);
  const client = updateRemoteClient(registered.client.id, owner.id, {
    policy: { mode: "restricted", allowlist: ["echo"] },
  });
  assert.ok(client);
  assert.equal(client.policy.mode, "restricted");
  assert.equal(authorizeRemoteAction(client, "write_file").allowed, false);
  assert.equal(authorizeRemoteAction(client, "execute_command", "echo hi").allowed, true);
  assert.equal(authorizeRemoteAction(client, "execute_command", "rm -rf /").allowed, false);
  assert.equal(authorizeRemoteAction(client, "execute_command", "rm -rf /").requiresApproval, false);
});

test("remote MCP schema does not expose a model-controlled approval boolean", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(path.join(process.cwd(), "lib/mcp-core/gateway-core.mjs"), "utf8");
  assert.doesNotMatch(source, /name: "remote_client_terminal"[\s\S]{0,900}approved:/);
  assert.doesNotMatch(source, /args\.approved/);
  assert.doesNotMatch(source, /approved: true/);
});

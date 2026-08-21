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

test("remote approval is owner-bound, argument-bound, and single-use", async () => {
  const { createUser } = await import("../lib/auth");
  const { createEnrollmentToken, registerRemoteClient, createRemoteApproval, approveRemoteApproval, consumeRemoteApproval } =
    await import("../lib/remote-clients");
  const owner = createUser("remote-owner", "password");
  const other = createUser("remote-other", "password");
  const enrollment = createEnrollmentToken(owner.id);
  const registered = registerRemoteClient(enrollment.token, { name: "test-client" });
  assert.ok(registered);
  const params = { command: "echo hello", cwd: dataDir };
  const approval = createRemoteApproval({
    ownerId: owner.id,
    clientId: registered.client!.id,
    action: "execute_command",
    params,
    source: "agent",
  });
  assert.equal(approveRemoteApproval(approval.id, other.id), false);
  assert.equal(approveRemoteApproval(approval.id, owner.id), true);
  assert.equal(consumeRemoteApproval({
    id: approval.id,
    ownerId: owner.id,
    clientId: registered.client!.id,
    action: "execute_command",
    params: { ...params, command: "echo changed" },
  }), false);
  assert.equal(consumeRemoteApproval({
    id: approval.id,
    ownerId: owner.id,
    clientId: registered.client!.id,
    action: "execute_command",
    params,
  }), true);
  assert.equal(consumeRemoteApproval({
    id: approval.id,
    ownerId: owner.id,
    clientId: registered.client!.id,
    action: "execute_command",
    params,
  }), false);
});

test("remote MCP schema does not expose a model-controlled approval boolean", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(path.join(process.cwd(), "lib/mcp-core/gateway-core.mjs"), "utf8");
  assert.doesNotMatch(source, /name: "remote_client_terminal"[\s\S]{0,900}approved:/);
  assert.doesNotMatch(source, /args\.approved/);
});

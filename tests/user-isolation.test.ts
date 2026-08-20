import assert from "node:assert/strict";
import test from "node:test";
import {
  assertExecutionUid,
  assertNonRootUid,
  isHostAdminUsername,
  isInsideWorkspace,
  isRootWorkspace,
  parsePasswdLine,
} from "../lib/user-isolation";

test("workspace containment rejects path escape", () => {
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice"), true);
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice/project"), true);
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice/../alice/project"), true);
  assert.equal(isInsideWorkspace("/home/alice", "/home/bob"), false);
  assert.equal(isInsideWorkspace("/home/alice", "/root"), false);
  assert.equal(isInsideWorkspace("/home/alice", "/home/alice/../bob"), false);
  assert.equal(isInsideWorkspace("/workspace", "/workspace/alice"), true);
  assert.equal(isInsideWorkspace("/workspace", "/home/alice"), false);
});

test("passwd parser extracts posix identity", () => {
  const parsed = parsePasswdLine("alice:x:1001:1001:Alice:/home/alice:/bin/bash");
  assert.deepEqual(parsed, {
    username: "alice",
    uid: 1001,
    gid: 1001,
    home: "/home/alice",
  });
  assert.equal(parsePasswdLine("root:x:0:0:root:/root:/bin/bash")?.uid, 0);
});

test("root uids are rejected for agent execution", () => {
  assert.throws(() => assertNonRootUid(0), /non-root/);
  assert.throws(() => assertNonRootUid(undefined), /non-root/);
  assert.doesNotThrow(() => assertNonRootUid(1000));
});

test("root execution requires explicit configuration and a root workspace", () => {
  assert.throws(() => assertExecutionUid(0), /explicitly configured/);
  assert.throws(() => assertExecutionUid(0, { allowRoot: true, workspaceRoot: "/home/alice" }), /explicitly configured/);
  assert.doesNotThrow(() => assertExecutionUid(0, { allowRoot: true, workspaceRoot: "/root/metis-ai" }));
  assert.equal(isRootWorkspace("/root/metis-ai"), true);
  assert.equal(isRootWorkspace("/home/alice"), false);
});

test("host admin usernames come from env or the first account", () => {
  assert.equal(isHostAdminUsername("f1shy312", { CHAT_USERNAME: "f1shy312" }), true);
  assert.equal(isHostAdminUsername("Trynocs", { CHAT_USERNAME: "f1shy312" }), false);
  assert.equal(
    isHostAdminUsername("ops", { METIS_AI_ADMIN_USERNAMES: "ops,other" }, "first"),
    true,
  );
  assert.equal(isHostAdminUsername("first", {}, "first"), true);
});

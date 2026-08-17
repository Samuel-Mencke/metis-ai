import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-trace-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");

const modulesPromise = import("../lib/agent-trace");
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("trace redaction strips secrets and truncates huge text", () => {
  const redacted = modules.redactTraceValue({
    authorization: "Bearer secret-token",
    apiKey: "sk-abcdefghijklmnop",
    nested: { password: "hunter2", ok: "visible" },
    blob: "x".repeat(9_000),
  }) as Record<string, unknown>;
  assert.equal(redacted.authorization, "[redacted]");
  assert.equal(redacted.apiKey, "[redacted]");
  assert.equal((redacted.nested as { password: string; ok: string }).password, "[redacted]");
  assert.equal((redacted.nested as { password: string; ok: string }).ok, "visible");
  assert.equal(String(redacted.blob).includes("[truncated"), true);
});

test("appendAgentTrace writes jsonl without raw token deltas", () => {
  const job = {
    id: randomUUID(),
    chatId: randomUUID(),
    createdAt: new Date().toISOString(),
    modelId: "cursor:test",
  };
  modules.appendAgentTrace(job, "start", { token: "sk-live-should-hide" });
  modules.appendAgentTrace(job, "text", { text: "hello world from the model" });
  const lines = readFileSync(modules.agentTracePath(job), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  const start = JSON.parse(lines[0]);
  const text = JSON.parse(lines[1]);
  assert.equal(start.event, "start");
  assert.equal(start.data.token, "[redacted]");
  assert.equal(text.data.chars, 26);
  assert.equal(text.data.tail, "hello world from the model");
});

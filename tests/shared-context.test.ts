import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-shared-context-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.MCP_BEARER_TOKEN = "shared-context-test-token";

const modulesPromise = Promise.all([
  import("../lib/db-store"),
  import("../lib/shared-context"),
  import("../lib/db-questions"),
  import("../app/api/internal/mcp-workspace/route"),
]);
let modules!: Awaited<typeof modulesPromise>;

let chatId = "";

before(() => {
  return modulesPromise.then((resolved) => {
    modules = resolved;
    chatId = modules[0].createChat("Shared context test").id;
  });
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("note creation is idempotent and optimistic conflicts are explicit", () => {
  const { createNote, listNotes, NoteConflictError, updateNote } = modules[1];
  const first = createNote({
    chatId,
    scope: "chat",
    title: "Context",
    content: "first",
    idempotencyKey: "same-note",
  });
  const retry = createNote({
    chatId,
    scope: "chat",
    title: "Context",
    content: "changed retry must not duplicate",
    idempotencyKey: "same-note",
  });
  assert.equal(retry.id, first.id);
  assert.equal(listNotes({ chatId }).length, 1);
  const updated = updateNote(first.id, { content: "second", expectedVersion: 1 });
  assert.equal(updated?.version, 2);
  assert.throws(
    () => updateNote(first.id, { content: "stale", expectedVersion: 1 }),
    (error) => error instanceof NoteConflictError,
  );
});

test("chat reverts restore chat notes without touching global notes", async () => {
  const { createNote, getNote, revertChatNotes, updateNote } = modules[1];
  const revertChatId = modules[0].createChat("Note revert test").id;
  const chatNote = createNote({
    chatId: revertChatId,
    scope: "chat",
    title: "Chat note",
    content: "before",
  });
  const globalNote = createNote({
    scope: "global",
    title: "Global note",
    content: "keep",
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const cutoff = new Date().toISOString();
  await new Promise((resolve) => setTimeout(resolve, 5));
  updateNote(chatNote.id, { content: "after" });
  createNote({
    chatId: revertChatId,
    scope: "chat",
    title: "Created after cutoff",
    content: "remove",
  });

  const reverted = revertChatNotes(revertChatId, undefined, cutoff);
  assert.equal(reverted.length, 2);
  assert.equal(getNote(chatNote.id)?.content, "before");
  assert.equal(getNote(globalNote.id)?.content, "keep");
});

test("snapshots survive through the latest-valid record path", () => {
  const { createSnapshot, getLatestSnapshot } = modules[1];
  const snapshot = createSnapshot({
    chatId,
    checkpoint: "important",
    runStatus: "interrupted",
    resumeMarker: { safe: false, reason: "test" },
    availability: "needs_attention",
  });
  assert.equal(getLatestSnapshot(chatId)?.id, snapshot.id);
  assert.equal(getLatestSnapshot(chatId)?.availability, "needs_attention");
});

test("ask_user answers exactly once and rejects stale versions", async () => {
  const { createPendingQuestion, resolveQuestion } = modules[2];
  const pending = createPendingQuestion(
    [{ question: "Continue?", options: ["Yes", "No"] }],
    chatId,
    undefined,
    { jobId: "job-test", runId: "run-test", timeoutMs: 5_000 },
  );
  const resolved = resolveQuestion(pending.questionId, ["Yes"], undefined, pending.version);
  assert.ok(resolved);
  assert.equal(resolved?.status, "answered");
  assert.equal(resolved?.answers[0], "Yes");
  const retry = resolveQuestion(pending.questionId, ["No"], undefined, pending.version);
  assert.ok(retry);
  assert.equal(retry?.status, "answered");
  assert.deepEqual(retry?.answers, ["Yes"]);
  assert.deepEqual(await pending.promise, ["Yes"]);
});

test("voice jobs enforce the hard duration limit", () => {
  const { createVoiceJob } = modules[1];
  assert.throws(
    () => createVoiceJob({
      mimeType: "audio/webm",
      durationSeconds: 3_601,
      sizeBytes: 100,
    }),
    /duration/,
  );
  const job = createVoiceJob({
    chatId,
    mimeType: "audio/webm",
    durationSeconds: 4,
    sizeBytes: 100,
    idempotencyKey: "voice-test",
  });
  assert.equal(job.status, "queued");
});

test("voice settings normalize provider defaults without retaining secrets", () => {
  const { normalizeVoiceSettings } = modules[1];
  const settings = normalizeVoiceSettings({
    provider: "custom",
    realtime: true,
    modelId: "  local-model  ",
    endpoint: " http://127.0.0.1:9000 ",
    maxDurationSeconds: 999999,
  });
  assert.equal(settings.provider, "custom");
  assert.equal(settings.modelId, "local-model");
  assert.equal(settings.realtime, true);
  assert.equal(settings.maxDurationSeconds, 3600);
  assert.equal("apiKey" in settings, false);
});

test("workspace creation is persisted, addressable, and idempotent", async () => {
  const { POST } = modules[3];
  const beforePage = modules[0].getChatPage(chatId, undefined, 100, 0);
  assert.equal(beforePage?.chat.workspaces?.length || 0, 0);
  const headers = {
    "Content-Type": "application/json",
    Authorization: "Bearer shared-context-test-token",
    "X-AI-Chat-Id": chatId,
    "X-AI-Chat-User-Id": "",
    "X-AI-Chat-Job-Id": "workspace-job",
    "Idempotency-Key": "workspace-retry",
  };
  const create = () => POST(new Request("http://localhost/api/internal/mcp-workspace", {
    method: "POST",
    headers,
    body: JSON.stringify({ type: "plan", title: "Durable plan", content: "# Plan" }),
  }));
  const first = await create();
  const firstBody = await first.json() as { id?: string; workspaceLink?: string };
  const retry = await create();
  const retryBody = await retry.json() as { id?: string };
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retryBody.id, firstBody.id);
  const list = await POST(new Request("http://localhost/api/internal/mcp-workspace", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "" },
    body: JSON.stringify({ action: "list", type: "plan" }),
  }));
  const listBody = await list.json() as { workspaces?: Array<{ id: string }> };
  assert.equal(listBody.workspaces?.filter((item) => item.id === firstBody.id).length, 1);
  const afterPage = modules[0].getChatPage(chatId, undefined, 100, 0);
  assert.equal(afterPage?.chat.workspaces?.some((item) => item.id === firstBody.id), true);
  const open = await POST(new Request("http://localhost/api/internal/mcp-workspace", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "" },
    body: JSON.stringify({ action: "open", id: firstBody.id }),
  }));
  const openBody = await open.json() as { workspaceLink?: string };
  assert.equal(openBody.workspaceLink, firstBody.workspaceLink);
});

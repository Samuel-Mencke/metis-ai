import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-owner-boundary-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
process.env.CHAT_PASSWORD = "";

const modulesPromise = Promise.all([
  import("../lib/auth"),
  import("../lib/db-store"),
  import("../lib/db-jobs"),
  import("../lib/db-questions"),
  import("../lib/shared-context"),
]);
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("owner-scoped stores fail closed for another owner and legacy-unowned rows", async () => {
  const [{ createUser }, { createChat }, jobs, questions, context] = modules;
  const { enqueueJob, appendRunEvent, listJobs, listRunEvents } = jobs;
  const { createPendingQuestion, resolveQuestion, getPendingQuestion } = questions;
  const {
    createNote,
    listNotes,
    getNote,
    createSnapshot,
    getLatestSnapshot,
    createVoiceJob,
    listVoiceJobs,
    getVoiceJob,
    getIdempotentResponse,
    saveIdempotentResponse,
  } = context;

  const ownerA = createUser(`owner-a-${randomUUID()}`, "password-a");
  const ownerB = createUser(`owner-b-${randomUUID()}`, "password-b");
  const ownerBChat = createChat("owner B", undefined, ownerB.id);
  const legacyChat = createChat("legacy", undefined, ownerB.id);

  const ownerBJob = enqueueJob({ chatId: ownerBChat.id, userId: ownerB.id, message: "owner B secret" });
  const legacyJob = enqueueJob({ chatId: legacyChat.id, message: "legacy secret" });
  appendRunEvent(ownerBJob.id, ownerBChat.id, ownerB.id, "text", "owner B event");
  appendRunEvent(legacyJob.id, legacyChat.id, undefined, "text", "legacy event");

  const ownerBNote = createNote({ ownerId: ownerB.id, title: "B note", content: "private" });
  const legacyNote = createNote({ title: "Legacy note", content: "private" });
  createSnapshot({
    chatId: ownerBChat.id,
    ownerId: ownerB.id,
    checkpoint: "important",
    runStatus: "idle",
    availability: "available",
  });
  const ownerBVoice = createVoiceJob({
    ownerId: ownerB.id,
    chatId: ownerBChat.id,
    mimeType: "audio/webm",
    durationSeconds: 1,
    sizeBytes: 10,
  });
  saveIdempotentResponse("owner-boundary", "same-key", { owner: ownerB.id }, ownerB.id, ownerBChat.id);
  const pending = createPendingQuestion(
    [{ question: "Owner B question?" }],
    ownerBChat.id,
    ownerB.id,
    { jobId: ownerBJob.id },
  );

  assert.deepEqual(listJobs(ownerBChat.id, ownerA.id), []);
  assert.deepEqual(listJobs(legacyChat.id, ownerA.id), []);
  assert.deepEqual(listRunEvents(ownerBChat.id, ownerA.id), []);
  assert.deepEqual(listNotes({ ownerId: ownerA.id }), []);
  assert.equal(getNote(ownerBNote.id, ownerA.id), null);
  assert.equal(getNote(legacyNote.id, ownerA.id), null);
  assert.equal(getLatestSnapshot(ownerBChat.id, ownerA.id), null);
  assert.deepEqual(listVoiceJobs(ownerA.id, ownerBChat.id), []);
  assert.equal(getVoiceJob(ownerBVoice.id, ownerA.id), null);
  assert.equal(getIdempotentResponse("owner-boundary", "same-key", ownerA.id, ownerBChat.id), null);
  assert.deepEqual(
    getIdempotentResponse<{ owner: string }>("owner-boundary", "same-key", ownerB.id, ownerBChat.id),
    { owner: ownerB.id },
  );
  assert.equal(resolveQuestion(pending.questionId, ["no"], ownerA.id), false);
  assert.equal(getPendingQuestion(pending.questionId, ownerA.id), null);

  await resolveQuestion(pending.questionId, ["yes"], ownerB.id, pending.version);
  assert.deepEqual(await pending.promise, ["yes"]);
});

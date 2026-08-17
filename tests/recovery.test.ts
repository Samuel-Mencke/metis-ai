import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

const dataDir = path.join(os.tmpdir(), `metis-recovery-${randomUUID()}`);
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.MCP_BEARER_TOKEN = "recovery-test-token";

const modulesPromise = Promise.all([
  import("../lib/db-store"),
  import("../lib/db-jobs"),
  import("../lib/recovery"),
  import("../lib/shared-context"),
]);
let modules!: Awaited<typeof modulesPromise>;

before(async () => {
  modules = await modulesPromise;
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("a live running checkpoint is not treated as restart attention", () => {
  const { createChat } = modules[0];
  const { enqueueJob, updateJob } = modules[1];
  const { resolveRecoverySnapshot } = modules[2];
  const { createSnapshot } = modules[3];
  const chat = createChat("Live run");
  const job = enqueueJob({ chatId: chat.id, message: "go" });
  updateJob(job.id, { status: "running" });
  createSnapshot({
    chatId: chat.id,
    checkpoint: "important",
    runStatus: "running",
    resumeMarker: { jobId: job.id, safe: false, reason: "Agent run was active at checkpoint." },
    availability: "available",
  });
  const resolved = resolveRecoverySnapshot(chat.id);
  assert.equal(resolved?.availability, "available");
  assert.equal(resolved?.runStatus, "running");
  updateJob(job.id, { status: "completed" });
});

test("an interrupted job needs attention until a newer snapshot dismisses it", async () => {
  const { createChat } = modules[0];
  const { enqueueJob, updateJob } = modules[1];
  const { resolveRecoverySnapshot } = modules[2];
  const { createSnapshot } = modules[3];
  const chat = createChat("Interrupted run");
  const job = enqueueJob({ chatId: chat.id, message: "go", agentId: "agent-1" });
  updateJob(job.id, { status: "interrupted", error: "Run interrupted by a worker restart; manual resume is required." });
  const resolved = resolveRecoverySnapshot(chat.id);
  assert.equal(resolved?.availability, "needs_attention");
  assert.equal(resolved?.resumeMarker?.jobId, job.id);
  assert.equal(resolved?.resumeMarker?.safe, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  createSnapshot({
    chatId: chat.id,
    checkpoint: "recovery",
    runStatus: "idle",
    resumeMarker: { safe: true, reason: "Interrupted run dismissed." },
    availability: "available",
  });
  assert.equal(resolveRecoverySnapshot(chat.id)?.availability, "available");
});

test("stale running snapshots without a live job do not keep the banner", () => {
  const { createChat } = modules[0];
  const { resolveRecoverySnapshot } = modules[2];
  const { createSnapshot } = modules[3];
  const chat = createChat("Stale snapshot");
  createSnapshot({
    chatId: chat.id,
    checkpoint: "important",
    runStatus: "running",
    resumeMarker: { safe: false, reason: "Agent run was active at checkpoint." },
    availability: "available",
  });
  const resolved = resolveRecoverySnapshot(chat.id);
  assert.equal(resolved?.availability, "available");
  assert.equal(resolved?.runStatus, "idle");
});

test("worker restart recovery requeues orphaned running jobs", () => {
  const { createChat } = modules[0];
  const { enqueueJob, updateJob, recoverStaleJobs, getJob } = modules[1];
  const { resolveRecoverySnapshot } = modules[2];
  const chat = createChat("Orphan");
  const job = enqueueJob({ chatId: chat.id, message: "go" });
  updateJob(job.id, { status: "running" });
  const recovered = recoverStaleJobs();
  assert.ok(recovered.resumed.some((item) => item.id === job.id));
  assert.equal(getJob(job.id)?.status, "queued");
  assert.match(getJob(job.id)?.resumePrompt || "", /Continue from the last saved/);
  assert.equal(resolveRecoverySnapshot(chat.id)?.availability, "available");
  updateJob(job.id, { status: "completed" });
});

test("periodic snapshots reuse one row and ignore unknown owner ids", () => {
  const { createChat } = modules[0];
  const { createSnapshot, getLatestSnapshot } = modules[3];
  const chat = createChat("Recovery owner");
  const first = createSnapshot({
    chatId: chat.id,
    ownerId: "missing-user",
    checkpoint: "periodic",
    runStatus: "idle",
    availability: "available",
  });
  const second = createSnapshot({
    chatId: chat.id,
    ownerId: "missing-user",
    checkpoint: "periodic",
    runStatus: "running",
    availability: "available",
  });
  assert.equal(second.id, first.id);
  assert.equal(getLatestSnapshot(chat.id)?.runStatus, "running");
});

test("a second chat can start immediately while a worker slot is free", () => {
  process.env.AI_CHAT_WORKER_CONCURRENCY = "2";
  const { createChat } = modules[0];
  const { enqueueJob } = modules[1];
  const first = enqueueJob({ chatId: createChat("Slot one").id, message: "one" });
  const second = enqueueJob({ chatId: createChat("Slot two").id, message: "two" });
  assert.equal(first.queueMessage, undefined);
  assert.equal(second.queueMessage, undefined);
});

test("claimNextJob skips an unreadable queued row instead of stalling the queue", async () => {
  const { createChat } = modules[0];
  const { enqueueJob, claimNextJob, getJob } = modules[1];
  const { getDatabase } = await import("../lib/sqlite");
  const blocked = enqueueJob({ chatId: createChat("Corrupt").id, message: "blocked" });
  const next = enqueueJob({ chatId: createChat("Healthy").id, message: "healthy" });
  getDatabase().prepare("UPDATE jobs SET data = ? WHERE id = ?").run("{not-json", blocked.id);
  const claimedIds: string[] = [];
  let claimed = claimNextJob();
  while (claimed && claimed.id !== next.id && claimedIds.length < 100) {
    claimedIds.push(claimed.id);
    claimed = claimNextJob();
  }
  assert.equal(claimed?.id, next.id);
  assert.equal(claimedIds.includes(blocked.id), false);
  assert.equal(getJob(blocked.id)?.status, "error");
});

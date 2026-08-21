import assert from "node:assert/strict";
import test from "node:test";
import { describeQueueWait, parseWorkerConcurrency, waitForSchedulerTick } from "../lib/worker-scheduler";

test("queue wait is omitted when a worker slot is still free", () => {
  assert.equal(describeQueueWait(0, 0, 2), undefined);
  assert.equal(describeQueueWait(1, 0, 2), undefined);
  assert.equal(describeQueueWait(0, 1, 2), undefined);
});

test("queue wait is shown only when this run cannot start yet", () => {
  assert.equal(
    describeQueueWait(2, 0, 2),
    "Max workers reached (2). Waiting for a free worker slot.",
  );
  assert.equal(
    describeQueueWait(0, 2, 2),
    "Waiting for a free worker slot (2 runs ahead, 2 parallel chats).",
  );
  assert.equal(
    describeQueueWait(2, 2, 2),
    "Waiting for a free worker slot (2 runs ahead, 2 parallel chats).",
  );
});

test("polls for more work while slots are free instead of waiting on the active job", async () => {
  let resolveJob!: () => void;
  const job = new Promise<void>((resolve) => {
    resolveJob = resolve;
  });
  const active = new Set<Promise<unknown>>([job]);
  const result = await waitForSchedulerTick(active, 2, 20);
  assert.equal(result, "capacity-poll");
  resolveJob();
  await job;
});

test("waits for a running job only when the worker is at capacity", async () => {
  let resolveJob!: () => void;
  const job = new Promise<void>((resolve) => {
    resolveJob = resolve;
  });
  const active = new Set<Promise<unknown>>([job]);
  setTimeout(resolveJob, 15);
  const result = await waitForSchedulerTick(active, 1, 5_000);
  assert.equal(result, "slot-freed");
});

test("parseWorkerConcurrency uses a bounded default for empty or invalid values", () => {
  assert.equal(parseWorkerConcurrency(undefined), 25);
  assert.equal(parseWorkerConcurrency(""), 25);
  assert.equal(parseWorkerConcurrency("  "), 25);
  assert.equal(parseWorkerConcurrency("0"), 25);
  assert.equal(parseWorkerConcurrency("Infinity"), 25);
  assert.equal(parseWorkerConcurrency("not-a-number"), 25);
  assert.equal(parseWorkerConcurrency("4"), 4);
});

test("queue wait is omitted when max workers is explicitly unlimited", () => {
  assert.equal(describeQueueWait(8, 3, Number.POSITIVE_INFINITY), undefined);
  assert.equal(describeQueueWait(2, 2, Number.NaN), undefined);
});

test("bounded concurrency waits at capacity", async () => {
  let resolveJob!: () => void;
  const job = new Promise<void>((resolve) => {
    resolveJob = resolve;
  });
  const active = new Set<Promise<unknown>>([job]);
  setTimeout(resolveJob, 15);
  const result = await waitForSchedulerTick(active, 1, 5_000);
  assert.equal(result, "slot-freed");
  resolveJob();
  await job;
});

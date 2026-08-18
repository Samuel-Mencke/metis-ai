import assert from "node:assert/strict";
import test from "node:test";
import { describeQueueWait, waitForSchedulerTick } from "../lib/worker-scheduler";

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

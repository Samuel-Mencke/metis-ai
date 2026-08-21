import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORKER_CONCURRENCY, workerConcurrency } from "../lib/worker-concurrency";

test("worker concurrency defaults to 25", () => {
  assert.equal(DEFAULT_WORKER_CONCURRENCY, 25);
  assert.equal(workerConcurrency(undefined), 25);
  assert.equal(workerConcurrency(""), 25);
  assert.equal(workerConcurrency("not-a-number"), 25);
});

test("worker concurrency keeps explicit positive values", () => {
  assert.equal(workerConcurrency("1"), 1);
  assert.equal(workerConcurrency("25"), 25);
  assert.equal(workerConcurrency("40"), 40);
  assert.equal(workerConcurrency("2.9"), 2);
});

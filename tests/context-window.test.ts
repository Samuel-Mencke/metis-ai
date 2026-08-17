import assert from "node:assert/strict";
import test from "node:test";
import {
  contextWindowForModel,
  contextWindowOf,
  inferContextWindow,
  resolveContextTotal,
} from "../lib/context-window";

test("contextWindowOf reads nested provider fields", () => {
  assert.equal(contextWindowOf({ max_input_tokens: 200_000 }), 200_000);
  assert.equal(contextWindowOf({ metadata: { context_window: 1_048_576 } }), 1_048_576);
  assert.equal(contextWindowOf({ contextWindow: 0 }), undefined);
});

test("inferContextWindow covers grok and gemini instead of a fake 128k cap", () => {
  assert.equal(inferContextWindow("cursor:grok-4.6"), 2_000_000);
  assert.equal(inferContextWindow("google:gemini-2.5-pro"), 1_048_576);
  assert.equal(inferContextWindow("anthropic:claude-sonnet-4-6"), 200_000);
});

test("resolveContextTotal does not report a 128k max when usage already exceeded it", () => {
  assert.equal(resolveContextTotal(128_000, 445_000), 0);
  assert.equal(resolveContextTotal(2_000_000, 445_000), 2_000_000);
  assert.equal(resolveContextTotal(undefined, 12_000), 0);
});

test("contextWindowForModel prefers catalog then inference", () => {
  assert.equal(contextWindowForModel({ id: "grok-4", contextWindow: 256_000 }), 256_000);
  assert.equal(contextWindowForModel({ id: "grok-4" }), 2_000_000);
});

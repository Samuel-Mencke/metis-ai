import assert from "node:assert/strict";
import test from "node:test";
import {
  composerLiveText,
  decideComposerSend,
  isDuplicateComposerSend,
  shouldAutoDrainQueue,
  shouldIgnoreComposerEnter,
} from "../lib/composer-send";

test("composerLiveText prefers non-empty DOM text over stale React state", () => {
  assert.equal(composerLiveText("hello from editor", ""), "hello from editor");
  assert.equal(composerLiveText("\n", "draft"), "draft");
  assert.equal(composerLiveText("  ", "draft"), "draft");
});

test("shouldIgnoreComposerEnter skips IME confirmation and key repeat", () => {
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false, isComposing: true }), true);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false, keyCode: 229 }), true);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false, repeat: true }), true);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldIgnoreComposerEnter({ key: "Enter", shiftKey: false }), false);
});

test("isDuplicateComposerSend blocks same-text Enter spam without blocking later retries", () => {
  const last = { text: "hi", at: 1000 };
  assert.equal(isDuplicateComposerSend("hi", last, 1500), true);
  assert.equal(isDuplicateComposerSend("hi", last, 2000), false);
  assert.equal(isDuplicateComposerSend("other", last, 1100), false);
});

test("decideComposerSend queues follow-ups while a run is in flight instead of dropping them", () => {
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: true,
      busy: false,
      waitingForQuestion: false,
      duplicate: false,
    }),
    "queue",
  );
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: true,
      busy: false,
      waitingForQuestion: false,
      duplicate: true,
    }),
    "ignore",
  );
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: false,
      busy: false,
      waitingForQuestion: false,
      duplicate: false,
    }),
    "send",
  );
  assert.equal(
    decideComposerSend({
      force: false,
      isOverride: false,
      hasContent: true,
      sendInFlight: false,
      busy: true,
      waitingForQuestion: true,
      duplicate: false,
    }),
    "queue",
  );
  assert.equal(
    decideComposerSend({
      force: true,
      isOverride: true,
      hasContent: true,
      sendInFlight: true,
      busy: false,
      waitingForQuestion: false,
      duplicate: false,
    }),
    "ignore",
  );
});

test("shouldAutoDrainQueue waits for sendInFlight and the drain lock", () => {
  assert.equal(
    shouldAutoDrainQueue({
      busy: false,
      sendInFlight: true,
      waitingForQuestion: false,
      drainBlocked: false,
      drainInProgress: false,
      queueLength: 1,
    }),
    false,
  );
  assert.equal(
    shouldAutoDrainQueue({
      busy: false,
      sendInFlight: false,
      waitingForQuestion: false,
      drainBlocked: false,
      drainInProgress: false,
      queueLength: 1,
    }),
    true,
  );
});

import { __resetClientTelemetryForTests, __queuedClientTelemetryForTests, reportUxEvent } from "../lib/client-telemetry";

test("reportUxEvent records dedupe and lock reason telemetry without visible UI", () => {
  __resetClientTelemetryForTests();
  reportUxEvent("send_rejected", { reason: "duplicate_fingerprint", duplicate: true });
  reportUxEvent("send_rejected", { reason: "lock_held", duplicate: false });
  const queued = __queuedClientTelemetryForTests();
  assert.equal(queued.length, 2);
  assert.equal(queued[0].message, "ux:send_rejected");
  assert.equal((queued[0].context?.detail as { reason?: string })?.reason, "duplicate_fingerprint");
  assert.equal((queued[1].context?.detail as { reason?: string })?.reason, "lock_held");
  // Identical event kind+message is deduped within 60s.
  reportUxEvent("send_rejected", { reason: "duplicate_fingerprint", duplicate: true });
  assert.equal(__queuedClientTelemetryForTests().length, 2);
});

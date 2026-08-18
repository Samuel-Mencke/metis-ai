import assert from "node:assert/strict";
import test from "node:test";
import {
  composerLiveText,
  decideComposerSend,
  isDuplicateComposerSend,
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
});

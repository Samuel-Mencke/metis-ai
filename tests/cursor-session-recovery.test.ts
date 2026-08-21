import assert from "node:assert/strict";
import test from "node:test";
import { canRecoverCursorSend, cursorSessionFailureKind } from "../lib/cursor-session-recovery";

test("cursorSessionFailureKind recognizes stale and active Cursor sessions", () => {
  assert.equal(cursorSessionFailureKind(new Error("Agent agent-1 already has active run")), "active_run");
  assert.equal(cursorSessionFailureKind(new Error("InvalidRunStateTransition")), "active_run");
  assert.equal(cursorSessionFailureKind(new Error("Agent agent-1 not found")), "missing");
  assert.equal(cursorSessionFailureKind(new Error("database is locked")), null);
});

test("canRecoverCursorSend retries only before any visible/tool progress and only once", () => {
  const error = new Error("Agent agent-1 already has active run");
  assert.equal(canRecoverCursorSend({ error, receivedTextDelta: false, toolCount: 0, alreadyRetried: false }), true);
  assert.equal(canRecoverCursorSend({ error, receivedTextDelta: true, toolCount: 0, alreadyRetried: false }), false);
  assert.equal(canRecoverCursorSend({ error, receivedTextDelta: false, toolCount: 1, alreadyRetried: false }), false);
  assert.equal(canRecoverCursorSend({ error, receivedTextDelta: false, toolCount: 0, alreadyRetried: true }), false);
});

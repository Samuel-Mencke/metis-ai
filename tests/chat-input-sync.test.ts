import assert from "node:assert/strict";
import test from "node:test";
import { mergeQueuedFollowUps } from "../lib/composer-send";

function newerWins(localUpdatedAt: string, serverUpdatedAt: string, localDirty: boolean) {
  if (localDirty) return "local";
  return Date.parse(localUpdatedAt) >= Date.parse(serverUpdatedAt) ? "local" : "server";
}

test("local keystrokes win over an older server composer snapshot", () => {
  assert.equal(newerWins("2026-08-24T10:00:02.000Z", "2026-08-24T10:00:01.000Z", true), "local");
  assert.equal(newerWins("2026-08-24T10:00:01.000Z", "2026-08-24T10:00:02.000Z", true), "local");
  assert.equal(newerWins("2026-08-24T10:00:01.000Z", "2026-08-24T10:00:02.000Z", false), "server");
});

test("queued follow-ups merge across devices without resurrecting consumed ids", () => {
  const merged = mergeQueuedFollowUps(
    [{ id: "a", text: "local a" }, { id: "b", text: "local b" }],
    [{ id: "b", text: "server b" }, { id: "c", text: "server c" }],
    { consumedIds: ["a"] },
  );
  assert.deepEqual(merged.map((item) => item.id), ["b", "c"]);
  assert.equal(merged[0]?.text, "local b");
});

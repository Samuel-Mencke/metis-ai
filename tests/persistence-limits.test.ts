import assert from "node:assert/strict";
import test from "node:test";
import { serializeRunEventData } from "../lib/db-jobs";
import {
  compactMessagePartsForPersistence,
  compactToolForPersistence,
  revertSnapshotFromTool,
} from "../lib/tool-persistence";
import type { MessagePart, ToolPart } from "../lib/store";

test("large run events stay parseable and bounded", () => {
  const huge = "x".repeat(850_000);
  const encoded = serializeRunEventData({
    callId: "call-1",
    name: "edit",
    status: "completed",
    result: huge,
    diff: { before: huge, after: huge },
  });
  const parsed = JSON.parse(encoded) as Record<string, unknown>;
  assert.equal(parsed.callId, "call-1");
  assert.equal(parsed.name, "edit");
  assert.ok(Buffer.byteLength(encoded, "utf8") <= 128 * 1024);
});

test("parsed subagent metadata replaces raw Cursor transcript persistence", () => {
  const tool: ToolPart = {
    id: "task-1",
    name: "task",
    status: "completed",
    kind: "subagent",
    result: JSON.stringify({
      value: {
        conversationSteps: [{ assistantMessage: { text: "raw transcript" } }],
      },
    }),
    subagent: {
      messages: [{ role: "assistant", text: "clean answer" }],
      tools: [],
    },
  };
  const compact = compactToolForPersistence(tool);
  assert.equal(compact.result, undefined);
  assert.equal(compact.subagent?.messages?.[0]?.text, "clean answer");
});

test("message parts keep ordering without duplicating full tool payloads", () => {
  const tool: ToolPart = {
    id: "edit-1",
    name: "edit",
    status: "completed",
    kind: "edit",
    path: "/tmp/example.ts",
    result: "r".repeat(100_000),
    diff: { before: "before", after: "after", additions: 1, deletions: 1 },
  };
  const snapshot = revertSnapshotFromTool(tool);
  assert.deepEqual(snapshot, { path: "/tmp/example.ts", before: "before", after: "after" });
  const compactTool = compactToolForPersistence(tool);
  assert.deepEqual(compactTool.diff, { additions: 1, deletions: 1 });
  assert.ok((compactTool.result?.length || 0) <= 64_000);

  const parts: MessagePart[] = [
    { type: "thinking", content: "thinking" },
    { type: "tool", ...tool },
    { type: "text", content: "done" },
  ];
  const compactParts = compactMessagePartsForPersistence(parts);
  assert.deepEqual(compactParts.map((part) => part.type), ["thinking", "tool", "text"]);
  const toolPart = compactParts[1];
  assert.equal(toolPart.type, "tool");
  if (toolPart.type === "tool") {
    assert.equal(toolPart.id, "edit-1");
    assert.equal(toolPart.result, undefined);
    assert.equal(toolPart.diff, undefined);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { timelineReducer, createInitialTimelineState } from "@/lib/runtime/timeline-reducer";
import { registerMcpSession, getMcpSession, handleMcpToolCall, METIS_MCP_TOOLS } from "@/lib/runtime/mcp-gateway";
import { driverRegistry } from "@/lib/runtime/driver-registry";

test("timelineReducer groups consecutive tools into a single ToolRun summary", () => {
  let state = createInitialTimelineState();
  state = timelineReducer(state, {
    type: "turn.started",
    turnId: "turn_1",
    timestamp: 1000,
  });

  state = timelineReducer(state, {
    type: "item.started",
    turnId: "turn_1",
    itemId: "tool_1",
    itemType: "mcp_tool_call",
    title: "run_command",
    input: { command: "ls" },
    timestamp: 1001,
  });

  state = timelineReducer(state, {
    type: "item.started",
    turnId: "turn_1",
    itemId: "tool_2",
    itemType: "mcp_tool_call",
    title: "view_file",
    input: { filePath: "package.json" },
    timestamp: 1002,
  });

  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].kind, "tool_group");
  if (state.items[0].kind === "tool_group") {
    assert.equal(state.items[0].tools.length, 2);
    assert.equal(state.items[0].summary, "Used 2 tools");
    assert.equal(state.items[0].status, "inProgress");
  }

  state = timelineReducer(state, {
    type: "item.completed",
    turnId: "turn_1",
    itemId: "tool_1",
    status: "completed",
    timestamp: 1003,
  });

  state = timelineReducer(state, {
    type: "item.completed",
    turnId: "turn_1",
    itemId: "tool_2",
    status: "completed",
    timestamp: 1004,
  });

  if (state.items[0].kind === "tool_group") {
    assert.equal(state.items[0].status, "completed");
  }
});

test("timelineReducer streams assistant commentary without duplicate cards", () => {
  let state = createInitialTimelineState();
  state = timelineReducer(state, {
    type: "content.delta",
    turnId: "turn_1",
    itemId: "msg_1",
    kind: "assistant_text",
    text: "Hello ",
    timestamp: 1000,
  });

  state = timelineReducer(state, {
    type: "content.delta",
    turnId: "turn_1",
    itemId: "msg_1",
    kind: "assistant_text",
    text: "world!",
    timestamp: 1001,
  });

  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].kind, "message");
  if (state.items[0].kind === "message") {
    assert.equal(state.items[0].text, "Hello world!");
  }
});

test("mcp-gateway registers sessions and handles file toolkit calls safely", async () => {
  const session = registerMcpSession({
    sessionId: "test_session_1",
    cwd: process.cwd(),
  });

  assert.ok(session.token);
  assert.equal(getMcpSession("test_session_1")?.cwd, process.cwd());

  const result = await handleMcpToolCall({
    sessionId: "test_session_1",
    name: "view_file",
    args: { filePath: "package.json", startLine: 1, endLine: 5 },
  });

  assert.ok(result.content[0].text.includes("name"));
  assert.ok(!result.isError);
});

test("driverRegistry registers all primary providers", () => {
  const claude = driverRegistry.getDriver("claude-code");
  assert.equal(claude.key, "claude-code");

  const codex = driverRegistry.getDriver("codex");
  assert.equal(codex.key, "codex");

  const antigravity = driverRegistry.getDriver("antigravity");
  assert.equal(antigravity.key, "antigravity");

  const cursor = driverRegistry.getDriver("cursor");
  assert.equal(cursor.key, "cursor");
});

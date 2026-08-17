import assert from "node:assert/strict";
import test from "node:test";
import {
  compactToolPreview,
  isToolRunning,
  layoutAssistantParts,
  remoteClientHostnameMap,
  todosFromToolPayload,
  toolCallHeadline,
  toolGroupLabel,
} from "../lib/tool-call-display";

type LayoutTool = { id: string; name?: string; kind?: string; status?: string };

test("compactToolPreview hides JSON payloads from titles", () => {
  assert.equal(compactToolPreview('{"status":"success","value":{"content":"const x = 1"}}'), undefined);
  assert.equal(compactToolPreview("ls -la src"), "ls -la src");
});

test("toolGroupLabel names MCP batches like GPT tool summaries", () => {
  assert.equal(toolGroupLabel(4, ["mcp", "mcp", "mcp", "mcp"]), "Used 4 MCP tools");
  assert.equal(toolGroupLabel(3, ["read", "mcp", "shell"]), "Used 3 tools");
  assert.equal(toolGroupLabel(2, ["read", "read"]), "Used 2 reads");
});

test("isToolRunning recognizes in-flight statuses", () => {
  assert.equal(isToolRunning("running"), true);
  assert.equal(isToolRunning("queued"), true);
  assert.equal(isToolRunning("completed"), false);
});

test("layoutAssistantParts separates glued consecutive sentences", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "text", content: "Remote-Tool-Calls beschriftet werden." },
    { type: "text", content: "Ursachen sind klar." },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "text");
  if (blocks[0]?.type === "text") {
    assert.equal(blocks[0].content, "Remote-Tool-Calls beschriftet werden.\n\nUrsachen sind klar.");
  }
});

test("layoutAssistantParts groups consecutive tools and splits after other content", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "thinking", content: "hmm", done: true },
    { type: "text", content: "I will look that up." },
    { type: "tool", id: "1", name: "search_tools", status: "completed" },
    { type: "text", content: "   " },
    { type: "tool", id: "2", name: "call_mcp_tool", status: "running" },
    { type: "text", content: "Here is the answer." },
  ]);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["thinking", "text", "tools", "text"],
  );
  const tools = blocks[2];
  const reply = blocks[3];
  assert.equal(tools.type, "tools");
  if (tools.type === "tools") {
    assert.deepEqual(tools.tools.map((tool) => tool.id), ["1", "2"]);
  }
  assert.equal(reply.type, "text");
  if (reply.type === "text") {
    assert.equal(reply.content, "Here is the answer.");
  }
});

test("layoutAssistantParts starts a new tool group after text, todos, and other cards", () => {
  const blocks = layoutAssistantParts<LayoutTool>([
    { type: "tool", id: "1", name: "read_file", kind: "read", status: "completed" },
    { type: "tool", id: "2", name: "grep", kind: "read", status: "completed" },
    { type: "text", content: "Next I will update the task list." },
    { type: "tool", id: "3", name: "write_todos", kind: "todo", status: "completed" },
    { type: "tool", id: "4", name: "edit_file", kind: "edit", status: "completed" },
    { type: "tool", id: "5", name: "shell", kind: "shell", status: "completed" },
    { type: "text", content: "Done." },
    { type: "tool", id: "6", name: "search_tools", kind: "mcp", status: "completed" },
  ]);
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["tools", "text", "tools", "tools", "text", "tools"],
  );
  assert.deepEqual(
    blocks
      .filter((block) => block.type === "tools")
      .map((block) => block.type === "tools" ? block.tools.map((tool) => tool.id) : []),
    [["1", "2"], ["3"], ["4", "5"], ["6"]],
  );
});

test("toolCallHeadline uses the local shell command as the title", () => {
  const headline = toolCallHeadline({
    name: "execute_command",
    kind: "shell",
    input: JSON.stringify({ command: "ollama pull x" }),
  });
  assert.equal(headline.title, "ollama pull x");
  assert.equal(headline.remote, undefined);
});

test("toolCallHeadline unwraps call_mcp_tool execute_command on a remote client", () => {
  const headline = toolCallHeadline({
    name: "call_mcp_tool",
    kind: "mcp",
    input: JSON.stringify({
      tool: "execute_command",
      arguments: { command: "ollama pull x", target: "client:abc" },
    }),
    hostnames: { abc: "DESKTOP-PD4H5G9" },
  });
  assert.equal(headline.title, "DESKTOP-PD4H5G9: ollama pull x");
  assert.equal(headline.remote, true);
});

test("toolCallHeadline labels a remote read with hostname and path", () => {
  const headline = toolCallHeadline({
    name: "call_mcp_tool",
    kind: "mcp",
    input: JSON.stringify({
      tool: "read_file",
      arguments: { path: "C:\\Users\\sam\\file.txt", target: "client:abc" },
    }),
    hostnames: { abc: "DESKTOP-PD4H5G9" },
  });
  assert.equal(headline.title, "DESKTOP-PD4H5G9: C:\\Users\\sam\\file.txt");
  assert.equal(headline.remote, true);
});

test("toolCallHeadline uses the nested MCP tool name instead of call_mcp_tool", () => {
  const headline = toolCallHeadline({
    name: "call_mcp_tool",
    kind: "mcp",
    input: JSON.stringify({ tool: "search_tools", arguments: { query: "browser" } }),
  });
  assert.match(headline.title, /search[_ ]tools/i);
  assert.doesNotMatch(headline.title, /call_mcp_tool/i);
  assert.equal(headline.preview, "browser");
});

test("remoteClientHostnameMap maps client ids and windows pc alias", () => {
  const map = remoteClientHostnameMap([
    { id: "abc", hostname: "DESKTOP-PD4H5G9", os: "windows" },
  ]);
  assert.equal(map.abc, "DESKTOP-PD4H5G9");
  assert.equal(map.pc, "DESKTOP-PD4H5G9");
  assert.equal(
    toolCallHeadline({
      name: "execute_command",
      kind: "mcp",
      input: JSON.stringify({ command: "hostname", target: "pc" }),
      hostnames: map,
    }).title,
    "DESKTOP-PD4H5G9: hostname",
  );
});

test("todosFromToolPayload reads todo lists from tool JSON", () => {
  const todos = todosFromToolPayload(
    JSON.stringify({
      todos: [
        { id: "1", content: "Fix composer", status: "completed" },
        { content: "Group tool calls", status: "in_progress" },
      ],
    }),
  );
  assert.equal(todos?.length, 2);
  assert.equal(todos?.[0]?.content, "Fix composer");
  assert.equal(todosFromToolPayload('{"status":"ok"}'), undefined);
});

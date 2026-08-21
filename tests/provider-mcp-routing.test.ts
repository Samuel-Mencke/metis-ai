import assert from "node:assert/strict";
import test from "node:test";
import { buildMcpContext } from "../lib/mcp";

test("buildMcpContext serializes a modePolicy object", () => {
  const context = buildMcpContext({
    chatId: "chat-1",
    modeId: "agent",
    modePolicy: {
      allowedCategories: ["read", "edit"],
      toolOverrides: { wait: "deny" },
    },
  });
  assert.equal(context.modeId, "agent");
  assert.equal(typeof context.modePolicy, "string");
  assert.deepEqual(JSON.parse(context.modePolicy || ""), {
    allowedCategories: ["read", "edit"],
    toolOverrides: { wait: "deny" },
  });
});

test("buildMcpContext keeps a string modePolicy and defaults missing toolOverrides", () => {
  assert.equal(buildMcpContext({ modePolicy: '{"allowedCategories":["read"]}' }).modePolicy, '{"allowedCategories":["read"]}');
  const serialized = buildMcpContext({
    modePolicy: { allowedCategories: ["browser"] },
  });
  assert.deepEqual(JSON.parse(serialized.modePolicy || ""), {
    allowedCategories: ["browser"],
    toolOverrides: {},
  });
});

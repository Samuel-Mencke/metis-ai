import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { before } from "node:test";

process.env.AI_CHAT_INTERNAL_URL = "http://127.0.0.1:1/internal";
process.env.AI_CHAT_INTERNAL_ORIGIN = "http://127.0.0.1:1";
process.env.AI_CHAT_PUBLIC_URL = "http://127.0.0.1:1";
const dataDir = mkdtempSync(path.join(os.tmpdir(), `metis-capabilities-${randomUUID()}-`));
process.env.CHAT_DATA_DIR = dataDir;
process.env.CHAT_DB_PATH = path.join(dataDir, "chat.sqlite");
process.env.AGENT_CWD = dataDir;
process.env.AI_CHAT_ROOT = dataDir;
let capabilityModule!: typeof import("../lib/capabilities");
before(async () => {
  capabilityModule = await import("../lib/capabilities");
});

test("capability manifests are deterministic and tamper-evident", () => {
  const manifest = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["write", "read", "read"],
    toolOverrides: { execute_command: false, read_file: true },
    childMcpGrants: { exa: ["web_search_exa"] },
  });
  const reordered = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["read", "write"],
    toolOverrides: { read_file: true, execute_command: false },
    childMcpGrants: { exa: ["web_search_exa"] },
  });
  assert.deepEqual(manifest, reordered);
  assert.equal(capabilityModule.capabilityManifestHash(manifest), capabilityModule.capabilityManifestHash(reordered));
  assert.notEqual(
    capabilityModule.capabilityManifestHash(manifest),
    capabilityModule.capabilityManifestHash({ ...manifest, ownerId: "owner-b" }),
  );
});

test("capability manifests are durable and immutable per attempt", async () => {
  const { createUser } = await import("../lib/auth");
  const ownerId = createUser(`manifest-owner-${randomUUID()}`, "password").id;
  const manifest = capabilityModule.createCapabilityManifest({
    ownerId,
    workspaceId: "workspace-a",
    runId: "run-a",
    attemptId: "attempt-a",
    allowedCategories: ["read"],
    childMcpGrants: { exa: ["web_search_exa"] },
  });
  assert.deepEqual(capabilityModule.persistCapabilityManifest(manifest), manifest);
  assert.deepEqual(capabilityModule.getCapabilityManifest(ownerId, "run-a", "attempt-a"), manifest);
  assert.throws(
    () => capabilityModule.persistCapabilityManifest({ ...manifest, allowedCategories: ["write"] }),
    /immutable/i,
  );
});

test("gateway discovery and execution use the same capability grant", async () => {
  // The package is an ESM runtime boundary without generated declarations.
  // @ts-expect-error Runtime-only MCP gateway module.
  const { dispatchGatewayTool, visibleToolsForContext } = await import("../packages/mcp-gateway/index.mjs");
  const manifest = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["read"],
    childMcpGrants: { exa: ["web_search_exa"] },
  });
  const context = {
    userId: "owner-a",
    jobId: "run-a",
    capabilityManifest: JSON.stringify(manifest),
    capabilityHash: capabilityModule.capabilityManifestHash(manifest),
  };
  const visible = new Set(visibleToolsForContext(context).map((tool: { name: string }) => tool.name));
  assert.equal(visible.has("read_file"), true);
  assert.equal(visible.has("write_file"), false);
  const denied = await dispatchGatewayTool("write_file", { path: "x", content: "x" }, { context });
  assert.equal(denied.isError, true);
  assert.match(denied.content?.[0]?.text || "", /capability manifest/i);
});

test("gateway rejects a manifest that is replayed for another run", async () => {
  // @ts-expect-error Runtime-only MCP gateway module.
  const { dispatchGatewayTool } = await import("../packages/mcp-gateway/index.mjs");
  const manifest = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["read"],
    childMcpGrants: { exa: ["web_search_exa"] },
  });
  const result = await dispatchGatewayTool("read_file", { path: "README.md" }, {
    context: {
      userId: "owner-a",
      jobId: "run-b",
      capabilityManifest: JSON.stringify(manifest),
      capabilityHash: capabilityModule.capabilityManifestHash(manifest),
    },
  });
  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text || "", /run mismatch/i);
});

test("tool categories are explicit and least-privilege", async () => {
  // @ts-expect-error Runtime-only MCP gateway module.
  const { tools, visibleToolsForContext } = await import("../packages/mcp-gateway/index.mjs");
  const allManifest = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["read", "write", "terminal", "browser", "memory", "remote", "plan", "subagent"],
    childMcpGrants: { exa: ["*"] },
  });
  const allContext = {
    userId: "owner-a",
    jobId: "run-a",
    capabilityManifest: JSON.stringify(allManifest),
    capabilityHash: capabilityModule.capabilityManifestHash(allManifest),
  };
  assert.equal(visibleToolsForContext(allContext).length, tools.length);

  const memoryManifest = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["memory"],
    childMcpGrants: {},
  });
  const memoryContext = {
    userId: "owner-a",
    jobId: "run-a",
    capabilityManifest: JSON.stringify(memoryManifest),
    capabilityHash: capabilityModule.capabilityManifestHash(memoryManifest),
  };
  const memoryTools = new Set(visibleToolsForContext(memoryContext).map((tool: { name: string }) => tool.name));
  assert.equal(memoryTools.has("create_note"), true);
  assert.equal(memoryTools.has("write_file"), false);
  assert.equal(memoryTools.has("execute_command"), false);

  const planManifest = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["plan"],
    childMcpGrants: {},
  });
  const planContext = {
    userId: "owner-a",
    jobId: "run-a",
    capabilityManifest: JSON.stringify(planManifest),
    capabilityHash: capabilityModule.capabilityManifestHash(planManifest),
  };
  const planTools = new Set(visibleToolsForContext(planContext).map((tool: { name: string }) => tool.name));
  assert.equal(planTools.has("create_plan"), true);
  assert.equal(planTools.has("create_note"), false);
});

test("malformed capability categories fail closed during discovery", async () => {
  // @ts-expect-error Runtime-only MCP gateway module.
  const { visibleToolsForContext } = await import("../packages/mcp-gateway/index.mjs");
  const manifest = {
    ...capabilityModule.createCapabilityManifest({
      ownerId: "owner-a",
      workspaceId: "workspace-a",
      runId: "run-a",
    allowedCategories: ["read"],
    childMcpGrants: {},
    }),
    allowedCategories: ["read", "unknown"],
  } as unknown as import("../lib/capabilities").CapabilityManifest;
  assert.throws(
    () => visibleToolsForContext({
      userId: "owner-a",
      jobId: "run-a",
      capabilityManifest: JSON.stringify(manifest),
      capabilityHash: capabilityModule.capabilityManifestHash(manifest),
    }),
    /malformed capability manifest categories/i,
  );
});

test("child MCP access is deny-by-default when a manifest has no grants", async () => {
  // @ts-expect-error Runtime-only MCP gateway module.
  const { visibleToolsForContext, dispatchGatewayTool } = await import("../packages/mcp-gateway/index.mjs");
  const manifest = capabilityModule.createCapabilityManifest({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    runId: "run-a",
    allowedCategories: ["read"],
  });
  const context = {
    userId: "owner-a",
    jobId: "run-a",
    capabilityManifest: JSON.stringify(manifest),
    capabilityHash: capabilityModule.capabilityManifestHash(manifest),
  };
  assert.deepEqual(manifest.childMcpGrants, {});
  assert.equal(visibleToolsForContext(context).some((tool: { name: string }) => tool.name === "call_mcp_tool"), true);
  const result = await dispatchGatewayTool("call_mcp_tool", {
    server: "exa",
    tool: "web_search_exa",
    arguments: { query: "secret" },
  }, { context });
  assert.equal(result.isError, true);
  assert.match(result.content?.[0]?.text || "", /not granted/i);
});

test("gateway rejects legacy manifests without an explicit child grant map", async () => {
  // @ts-expect-error Runtime-only MCP gateway module.
  const { visibleToolsForContext } = await import("../packages/mcp-gateway/index.mjs");
  const manifest = {
    ...capabilityModule.createCapabilityManifest({
      ownerId: "owner-a",
      workspaceId: "workspace-a",
      runId: "run-a",
      allowedCategories: ["read"],
    }),
  } as Record<string, unknown>;
  delete manifest.childMcpGrants;
  assert.throws(
    () => visibleToolsForContext({
      userId: "owner-a",
      jobId: "run-a",
      capabilityManifest: JSON.stringify(manifest),
      capabilityHash: capabilityModule.capabilityManifestHash(manifest as never),
    }),
    /Malformed capability manifest/i,
  );
});

test("child MCP cache keys are owner-scoped", async () => {
  // @ts-expect-error Runtime-only MCP gateway module.
  const { childCacheKey } = await import("../packages/mcp-gateway/index.mjs");
  assert.notEqual(
    childCacheKey("owner-server", { userId: "owner-a" }),
    childCacheKey("owner-server", { userId: "owner-b" }),
  );
  assert.equal(
    childCacheKey("global-server", { userId: "owner-a" }),
    childCacheKey("global-server", { userId: "owner-a" }),
  );
});

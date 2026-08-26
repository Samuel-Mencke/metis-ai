import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("cursor worker forwards live tool and thinking updates from onDelta", () => {
  const source = readFileSync(path.join(root, "lib", "worker-runner.ts"), "utf8");
  assert.match(source, /handleDelta/);
  assert.match(source, /tool-call-started/);
  assert.match(source, /thinking-delta/);
  assert.match(source, /markSendProgress/);
  assert.match(source, /resolveMcpToolName/);
  assert.doesNotMatch(
    source,
    /if \(cancellationRequested \|\| update\.type !== "text-delta"\) return;/,
  );
});

test("cursor tool updates accept flat and nested SDK payload shapes", () => {
  const source = readFileSync(path.join(root, "lib", "worker-runner.ts"), "utf8");
  assert.match(source, /normalizedToolDelta/);
  assert.match(source, /toolCallId/);
  assert.match(source, /tool_input/);
  assert.match(source, /tool_result/);
  assert.match(source, /toolCall \\|\\| update\\.tool_call/);
});

test("xAI provider path exposes live web search tools", () => {
  const source = readFileSync(path.join(root, "lib", "providers", "adapters", "provider-support.ts"), "utf8");
  assert.match(source, /tools\.webSearch|tools\.web_search/);
  assert.match(source, /\.responses\(modelId\)/);
  assert.match(source, /onThinking/);
  assert.match(source, /part\.type === "reasoning-delta"/);
});

test("runtime timeline transport is durable SSE, not a client-side process-local bus", () => {
  const hook = readFileSync(path.join(root, "hooks", "use-timeline.ts"), "utf8");
  const route = readFileSync(path.join(root, "app", "api", "runtime", "events", "route.ts"), "utf8");
  assert.doesNotMatch(hook, /runtimeEventBus/);
  assert.match(hook, /new EventSource\(/);
  assert.match(route, /listRunEvents\(/);
  assert.match(route, /runtimeEventFromRunEvent/);
  assert.doesNotMatch(route, /runtimeEventBus/);
});


test("workspace creation schemas require real content and worker loads deploy overrides", () => {
  const gateway = readFileSync(path.join(root, "lib", "mcp-core", "gateway-core.mjs"), "utf8");
  const workerUnit = readFileSync(path.join(root, "deploy", "systemd", "metis-ai-worker.service.template"), "utf8");
  const plan = gateway.slice(gateway.indexOf('name: "create_plan"'), gateway.indexOf('name: "create_canvas"'));
  const canvasStart = gateway.indexOf('name: "create_canvas"');
  const canvas = gateway.slice(canvasStart, gateway.indexOf('name: "edit_plan"', canvasStart));
  assert.match(plan, /content: \{ type: "string", minLength: 1 \}/);
  assert.match(plan, /required: \["content"\]/);
  assert.match(canvas, /content: \{ type: "string", minLength: 1 \}/);
  assert.match(canvas, /required: \["content"\]/);
  assert.match(workerUnit, /EnvironmentFile=-YOUR_INSTALL_DIR\/.deploy\.env/);
});

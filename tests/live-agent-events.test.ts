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
  const source = readFileSync(path.join(root, "lib", "providers", "runner.ts"), "utf8");
  assert.match(source, /tools\.web_search/);
  assert.match(source, /\.responses\(modelId\)/);
  assert.match(source, /onThinking/);
  assert.match(source, /part\.type === "reasoning-delta"/);
});

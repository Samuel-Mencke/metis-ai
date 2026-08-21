import assert from "node:assert/strict";
import test from "node:test";
import type { ModelMessage } from "ai";
import {
  contextModeOf,
  effectiveContextBudget,
  estimateContextTokens,
  contextWindowForSelection,
} from "../lib/context-window";
import { compactProviderMessages, codexReasoningEffortForSelection } from "../lib/providers/runner";

const toolHistory: ModelMessage[] = [
  { role: "user", content: "Keep the current task and file state." },
  {
    role: "assistant",
    content: [{
      type: "tool-call",
      toolCallId: "read-1",
      toolName: "read_file",
      input: { path: "/workspace/src/important.ts", offset: 1, limit: 200 },
    }],
  },
  {
    role: "tool",
    content: [{
      type: "tool-result",
      toolCallId: "read-1",
      toolName: "read_file",
      output: {
        type: "text",
        value: `${"large file content ".repeat(4_000)}\nERROR: preserve this failure\nTODO: keep this todo`,
      },
    }],
  },
  { role: "assistant", content: "The file needs a focused fix." },
  { role: "user", content: "Continue without repeating completed work." },
  { role: "assistant", content: "Latest tail must remain available." },
];

test("compaction counts large tool payloads and stays within the effective budget", () => {
  const budget = effectiveContextBudget(4_000);
  const compacted = compactProviderMessages(toolHistory, 4_000);
  const estimated = compacted.reduce((sum, message) => sum + estimateContextTokens(message), 0);

  assert.ok(estimated <= budget, `estimated ${estimated} exceeds budget ${budget}`);
  assert.ok(JSON.stringify(compacted).includes("[metis-context-recap:v1]"));
  assert.ok(JSON.stringify(compacted).includes("Latest tail must remain available."));
});

test("compaction is deterministic and idempotent", () => {
  const once = compactProviderMessages(toolHistory, 4_000);
  const twice = compactProviderMessages(once, 4_000);
  assert.deepEqual(twice, once);
});

test("limited mode reduces the effective budget explicitly", () => {
  assert.equal(contextModeOf([{ id: "contextMode", value: "limited" }]), "limited");
  assert.ok(effectiveContextBudget(200_000, "limited") < effectiveContextBudget(200_000, "normal"));
});

test("compaction emits a structured start and completion event", () => {
  const events: Array<Record<string, unknown>> = [];
  compactProviderMessages(toolHistory, 4_000, "normal", (event) => events.push(event));
  assert.equal(events[0]?.type, "compaction");
  assert.equal(events[0]?.status, "started");
  assert.equal(events.at(-1)?.status, "completed");
  assert.equal(typeof events.at(-1)?.afterTokens, "number");
});

test("Codex reasoning effort accepts only supported values", () => {
  assert.equal(
    codexReasoningEffortForSelection("gpt-5.6", [{ id: "effort", value: "xhigh" }]),
    "xhigh",
  );
  assert.equal(
    codexReasoningEffortForSelection("claude-opus-4-6", [{ id: "effort", value: "high" }]),
    undefined,
  );
  assert.equal(
    codexReasoningEffortForSelection("gpt-5.6", [{ id: "effort", value: "unsupported" }]),
    undefined,
  );
});

test("272K is selected only by an explicit matching context selection", () => {
  const model = { id: "gpt-5.6-sol", providerId: "cursor" };
  assert.notEqual(contextWindowForSelection(model), 272_000);
  assert.equal(
    contextWindowForSelection(model, [{ id: "context", value: "272k" }]),
    272_000,
  );
});

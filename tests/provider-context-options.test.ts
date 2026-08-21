import assert from "node:assert/strict";
import test from "node:test";
import { anthropicProviderOptionsForSelection } from "../lib/providers/runner";

test("Anthropic 1M beta is sent only for explicit compatible selections", () => {
  assert.deepEqual(
    anthropicProviderOptionsForSelection("claude-sonnet-4.5", [{ id: "context", value: "1m" }]),
    { anthropic: { anthropicBeta: ["context-1m-2025-08-07"] } },
  );
  assert.equal(
    anthropicProviderOptionsForSelection("claude-sonnet-4.5", [{ id: "context", value: "200k" }]),
    undefined,
  );
  assert.equal(
    anthropicProviderOptionsForSelection("claude-sonnet-4.6", [{ id: "context", value: "1m" }]),
    undefined,
  );
});

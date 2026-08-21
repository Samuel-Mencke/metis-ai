import assert from "node:assert/strict";
import test from "node:test";
import { allModes, modeById, normalizeMode } from "../lib/modes";

test("built-in modes have the intended permission boundaries", () => {
  const modes = allModes();
  assert.deepEqual(modeById("agent").allowedCategories.sort(), [
    "browser", "memory", "plan", "read", "remote", "subagent", "terminal", "write",
  ]);
  assert.deepEqual(modeById("plan").allowedCategories.sort(), ["browser", "memory", "plan", "read", "subagent"]);
  assert.deepEqual(modeById("ask").allowedCategories.sort(), ["browser", "read"]);
});

test("custom mode permissions normalize categories and overrides", () => {
  const mode = normalizeMode({
    id: "review",
    name: "Review",
    description: "Read-only review",
    icon: "eye",
    instructions: "Inspect carefully.",
    allowedCategories: ["read", "read", "not-a-category" as never],
    toolOverrides: { write_file: false, read_file: true },
  });
  assert.deepEqual(mode.allowedCategories, ["read"]);
  assert.deepEqual(mode.toolOverrides, { write_file: false, read_file: true });
  assert.equal(modeById("review", [mode]).id, "review");
});

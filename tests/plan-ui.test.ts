import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cardSource = readFileSync(
  new URL("../components/plan-workspace-card.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../components/app-shell.tsx", import.meta.url),
  "utf8",
);

test("chat plan card stays compact and points to the workspace", () => {
  assert.match(cardSource, /compact\?: boolean/);
  assert.match(cardSource, /Full plan available in the workspace/);
  assert.match(cardSource, /workspaceLink/);
});

test("workspace plan card keeps full content and parallel build affordance", () => {
  assert.match(cardSource, /Build in parallel/);
  assert.match(shellSource, /multiAgent: true/);
  assert.match(shellSource, /Subagents/);
});

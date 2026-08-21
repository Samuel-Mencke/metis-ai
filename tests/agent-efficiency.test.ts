import assert from "node:assert/strict";
import test from "node:test";
import { LoopGuard, growStepBudget, routeTask } from "../lib/agent-efficiency";

test("task routing keeps trivial questions on a small budget", () => {
  const route = routeTask("Was ist der Status?");
  assert.equal(route.kind, "lookup");
  assert.ok(route.initialSteps < route.maxSteps);
  assert.equal(route.parallelizable, false);
});

test("task routing detects large independent work", () => {
  const route = routeTask("Build and implement this large change:\n" + Array.from({ length: 9 }, (_, i) => `- Change file ${i}.ts`).join("\n"));
  assert.equal(route.kind, "large");
  assert.equal(route.parallelizable, true);
  assert.ok(growStepBudget(route, route.initialSteps, true) > route.initialSteps);
});

test("loop guard stops repeated calls, failures, and no-progress runs", () => {
  const guard = new LoopGuard();
  assert.equal(guard.observe({ signature: "read_file:a", progressed: false, failed: false }).shouldStop, false);
  assert.equal(guard.observe({ signature: "read_file:a", progressed: false, failed: false }).shouldStop, false);
  assert.equal(guard.observe({ signature: "read_file:a", progressed: false, failed: false }).reason, "repeated_tool_call");
});

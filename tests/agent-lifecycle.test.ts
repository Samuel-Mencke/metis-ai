import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_LIFECYCLE_STAGES,
  agentStageAllowsMutation,
  agentStageNeedsRuntimeObservation,
  canTransitionAgentStage,
  isAgentLifecycleTerminal,
  normalizeAgentLifecycleStage,
  transitionAgentStage,
} from "../lib/runtime/agent-lifecycle";

test("agent lifecycle exposes one deterministic ordered stage set", () => {
  assert.deepEqual(AGENT_LIFECYCLE_STAGES, [
    "explore",
    "plan",
    "execute",
    "verify",
    "review",
    "repair",
    "done",
  ]);
  assert.equal(normalizeAgentLifecycleStage("verify"), "verify");
  assert.equal(normalizeAgentLifecycleStage("unknown"), "explore");
});

test("only execute and repair mutate the workspace", () => {
  for (const stage of AGENT_LIFECYCLE_STAGES) {
    assert.equal(
      agentStageAllowsMutation(stage),
      stage === "execute" || stage === "repair",
    );
  }
  assert.equal(agentStageNeedsRuntimeObservation("verify"), true);
  assert.equal(agentStageNeedsRuntimeObservation("review"), false);
});

test("happy-path lifecycle advances through verification before review", () => {
  let stage = transitionAgentStage("explore", "advance");
  assert.equal(stage, "plan");
  stage = transitionAgentStage(stage, "advance");
  assert.equal(stage, "execute");
  stage = transitionAgentStage(stage, "advance");
  assert.equal(stage, "verify");
  stage = transitionAgentStage(stage, "advance");
  assert.equal(stage, "review");
  stage = transitionAgentStage(stage, "complete");
  assert.equal(stage, "done");
  assert.equal(isAgentLifecycleTerminal(stage), true);
});

test("review/verification defects enter repair and then re-verify", () => {
  assert.equal(canTransitionAgentStage("verify", "repair"), true);
  assert.equal(transitionAgentStage("verify", "needs_repair"), "repair");
  assert.equal(transitionAgentStage("review", "needs_repair"), "repair");
  assert.equal(transitionAgentStage("repair", "advance"), "verify");
  assert.equal(canTransitionAgentStage("done", "execute"), false);
});

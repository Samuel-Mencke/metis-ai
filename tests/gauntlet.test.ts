import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGauntletPlan,
  gauntletCompletionGate,
  inferRuntimeImpact,
} from "../lib/runtime/gauntlet";
import type { VerificationReport } from "../lib/runtime/verification";

const verification: VerificationReport = {
  verdict: "pass",
  surface: "api",
  claim: "Changed runtime behavior works through the public API.",
  steps: [
    { kind: "claim", action: "Drive changed request", observation: "Expected response/state observed" },
    { kind: "probe", action: "Drive adjacent invalid request", observation: "Clean failure observed" },
  ],
};

test("small ordinary tasks do not pay gauntlet overhead", () => {
  const plan = buildGauntletPlan("What does this function do?");
  assert.equal(plan.enabled, false);
  assert.equal(plan.level, "off");
});

test("large implementation work automatically enters the gauntlet", () => {
  const plan = buildGauntletPlan("Fix the entire browser runtime and queue architecture end-to-end");
  assert.equal(plan.enabled, true);
  assert.equal(plan.runtimeImpact, true);
  assert.deepEqual(plan.stages, [
    "explore",
    "plan",
    "execute",
    "verify",
    "review",
    "repair",
    "done",
  ]);
});

test("explicit gauntlet in plan mode remains read-only", () => {
  const plan = buildGauntletPlan("/gauntlet redesign the complete runtime", { modeId: "plan" });
  assert.equal(plan.enabled, true);
  assert.equal(plan.planningOnly, true);
  assert.deepEqual(plan.stages, ["explore", "plan", "done"]);
});

test("runtime-impacting work cannot complete without verification and review", () => {
  const plan = buildGauntletPlan("Fix the whole worker runtime architecture");
  assert.equal(
    gauntletCompletionGate({
      plan,
      verification: null,
      reviewPassed: true,
      repairLoops: 0,
    }).ok,
    false,
  );
  assert.equal(
    gauntletCompletionGate({
      plan,
      verification,
      reviewPassed: false,
      repairLoops: 0,
    }).ok,
    false,
  );
  assert.deepEqual(
    gauntletCompletionGate({
      plan,
      verification,
      reviewPassed: true,
      repairLoops: 1,
    }),
    { ok: true, errors: [] },
  );
});

test("runtime impact classifier ignores documentation-only work", () => {
  assert.equal(inferRuntimeImpact("Fix the README typo and documentation formatting"), false);
  assert.equal(inferRuntimeImpact("Fix the browser worker queue"), true);
});

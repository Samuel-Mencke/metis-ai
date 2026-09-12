import assert from "node:assert/strict";
import test from "node:test";

import {
  validateVerificationReport,
  verificationAllowsCompletion,
  type VerificationReport,
} from "../lib/runtime/verification";

const passing: VerificationReport = {
  verdict: "pass",
  surface: "browser",
  claim: "Queued chat messages continue after the active run ends.",
  steps: [
    {
      kind: "claim",
      action: "Submit a second chat message while the first run is active, then finish the first run.",
      observation: "The queued message starts next and streams into the same chat.",
    },
    {
      kind: "probe",
      action: "Cancel the first run while another message is queued.",
      observation: "The cancelled run becomes terminal and the queued run can start without an active-run error.",
    },
  ],
};

test("runtime PASS requires claim observation and a probe", () => {
  assert.deepEqual(validateVerificationReport(passing), { ok: true, errors: [] });
  const noProbe = {
    ...passing,
    steps: passing.steps.filter((step) => step.kind !== "probe"),
  };
  assert.equal(validateVerificationReport(noProbe).ok, false);
});

test("tests-only evidence cannot masquerade as runtime PASS", () => {
  const report: VerificationReport = {
    verdict: "pass",
    surface: "none",
    claim: "Feature works",
    steps: [
      { kind: "claim", action: "Run tests", observation: "Tests passed" },
      { kind: "probe", action: "Run typecheck", observation: "Typecheck passed" },
    ],
  };
  assert.equal(validateVerificationReport(report).ok, false);
  assert.equal(
    verificationAllowsCompletion(report, { runtimeImpact: true }).ok,
    false,
  );
});

test("no-runtime changes may SKIP only with an explicit reason", () => {
  const skip: VerificationReport = {
    verdict: "skip",
    surface: "none",
    claim: "README wording only",
    reason: "The diff changes documentation only and has no executable surface.",
    steps: [],
  };
  assert.equal(validateVerificationReport(skip).ok, true);
  assert.equal(
    verificationAllowsCompletion(skip, { runtimeImpact: false }).ok,
    true,
  );
  assert.equal(
    verificationAllowsCompletion(skip, { runtimeImpact: true }).ok,
    false,
  );
});

test("blocked verification never completes runtime-impacting work", () => {
  const blocked: VerificationReport = {
    verdict: "blocked",
    surface: "browser",
    claim: "Login flow works",
    reason: "The development browser could not be launched.",
    steps: [],
  };
  assert.equal(validateVerificationReport(blocked).ok, true);
  assert.equal(
    verificationAllowsCompletion(blocked, { runtimeImpact: true }).ok,
    false,
  );
});

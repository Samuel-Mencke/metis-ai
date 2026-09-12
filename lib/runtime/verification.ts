export const VERIFICATION_SURFACES = [
  "cli",
  "api",
  "browser",
  "library",
  "agent",
  "workflow",
  "none",
] as const;

export type VerificationSurface = (typeof VERIFICATION_SURFACES)[number];
export type VerificationVerdict = "pass" | "fail" | "blocked" | "skip";
export type VerificationStepKind = "claim" | "probe";

export type VerificationStep = {
  kind: VerificationStepKind;
  action: string;
  observation: string;
  evidence?: string;
};

export type VerificationReport = {
  verdict: VerificationVerdict;
  surface: VerificationSurface;
  claim: string;
  steps: VerificationStep[];
  reason?: string;
};

export type VerificationGateResult = {
  ok: boolean;
  errors: string[];
};

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateVerificationReport(
  report: VerificationReport,
): VerificationGateResult {
  const errors: string[] = [];

  if (!nonEmpty(report.claim)) errors.push("verification claim is required");

  if (report.verdict === "blocked") {
    if (!nonEmpty(report.reason)) errors.push("blocked verification requires a reason");
    return { ok: errors.length === 0, errors };
  }

  if (report.verdict === "skip") {
    if (report.surface !== "none")
      errors.push("skip is valid only when there is no runtime surface");
    if (!nonEmpty(report.reason)) errors.push("skipped verification requires a reason");
    return { ok: errors.length === 0, errors };
  }

  if (report.surface === "none") {
    errors.push(`${report.verdict} requires a real runtime surface`);
  }

  const usableSteps = report.steps.filter(
    (step) => nonEmpty(step.action) && nonEmpty(step.observation),
  );
  if (!usableSteps.some((step) => step.kind === "claim")) {
    errors.push("runtime verification requires at least one claim-path observation");
  }
  if (!usableSteps.some((step) => step.kind === "probe")) {
    errors.push("runtime verification requires at least one adjacent failure/edge probe");
  }

  return { ok: errors.length === 0, errors };
}

export function verificationAllowsCompletion(
  report: VerificationReport | null | undefined,
  options: { runtimeImpact: boolean },
): VerificationGateResult {
  if (!report) {
    return options.runtimeImpact
      ? { ok: false, errors: ["runtime-impacting work requires runtime verification"] }
      : { ok: true, errors: [] };
  }

  const validation = validateVerificationReport(report);
  if (!validation.ok) return validation;

  if (report.verdict === "pass") return { ok: true, errors: [] };
  if (report.verdict === "skip" && !options.runtimeImpact)
    return { ok: true, errors: [] };

  return {
    ok: false,
    errors: [
      report.verdict === "fail"
        ? "runtime verification failed"
        : report.verdict === "blocked"
          ? `runtime verification blocked: ${report.reason || "unknown reason"}`
          : "runtime-impacting work cannot skip runtime verification",
    ],
  };
}

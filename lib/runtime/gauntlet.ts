import type { AgentLifecycleStage } from "@/lib/runtime/agent-lifecycle";
import {
  verificationAllowsCompletion,
  type VerificationReport,
} from "@/lib/runtime/verification";

export type GauntletLevel = "off" | "standard" | "deep";

export type GauntletPlan = {
  enabled: boolean;
  level: GauntletLevel;
  planningOnly: boolean;
  runtimeImpact: boolean;
  stages: AgentLifecycleStage[];
  maxRepairLoops: number;
  reason: string;
};

export type GauntletCompletionInput = {
  plan: GauntletPlan;
  verification?: VerificationReport | null;
  reviewPassed: boolean;
  repairLoops: number;
};

const EXPLICIT_RE = /(?:^|\s)(?:\/goal|\/gauntlet)(?:\s|$)|\bgauntlet\b/i;
const LARGE_RE = /\b(?:overall|entire|whole|komplett|alles|all(?:\s+the)?|architecture|architektur|rework|overhaul|migration|merge|stabil(?:e|ize|isieren)|autonom|end[- ]to[- ]end|e2e)\b/i;
const CODE_RE = /\b(?:repo|repository|code|codebase|branch|runtime|worker|queue|browser|api|server|database|db|typescript|javascript|react|next(?:\.js)?|provider|agent|mcp|tool|test|build|deploy|fix|implement|refactor|bug|fehler|kaputt)\b/i;
const MUTATION_RE = /\b(?:fix|fixe|implement|build|baue|mach|mache|change|änder|aender|refactor|repair|reparier|merge|update|upgrade|remove|entfern|add|hinzufüg)\w*/i;
const PLAN_MODE_RE = /^(?:plan|planning)$/i;
const NON_RUNTIME_RE = /\b(?:docs?|documentation|readme|comment|comments|typo|spelling|formatting|markdown)\b/i;

export function inferRuntimeImpact(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (NON_RUNTIME_RE.test(text) && !CODE_RE.test(text.replace(NON_RUNTIME_RE, "")))
    return false;
  return CODE_RE.test(text) && MUTATION_RE.test(text);
}

export function buildGauntletPlan(
  message: string,
  options: { modeId?: string; explicit?: boolean } = {},
): GauntletPlan {
  const text = message.trim();
  const planningOnly = PLAN_MODE_RE.test(options.modeId || "");
  const explicit = options.explicit === true || EXPLICIT_RE.test(text);
  const large = LARGE_RE.test(text) && CODE_RE.test(text);
  const runtimeImpact = inferRuntimeImpact(text);
  const enabled = explicit || large;

  if (!enabled) {
    return {
      enabled: false,
      level: "off",
      planningOnly,
      runtimeImpact,
      stages: [],
      maxRepairLoops: 0,
      reason: "Task does not require the long-running gauntlet.",
    };
  }

  if (planningOnly) {
    return {
      enabled: true,
      level: explicit ? "deep" : "standard",
      planningOnly: true,
      runtimeImpact,
      stages: ["explore", "plan", "done"],
      maxRepairLoops: 0,
      reason: explicit ? "Explicit gauntlet request in plan mode." : "Large planning task.",
    };
  }

  return {
    enabled: true,
    level: explicit ? "deep" : "standard",
    planningOnly: false,
    runtimeImpact,
    stages: runtimeImpact
      ? ["explore", "plan", "execute", "verify", "review", "repair", "done"]
      : ["explore", "plan", "execute", "review", "repair", "done"],
    maxRepairLoops: explicit ? 3 : 2,
    reason: explicit ? "Explicit gauntlet request." : "Large multi-surface implementation task.",
  };
}

export function gauntletCompletionGate(input: GauntletCompletionInput) {
  const errors: string[] = [];
  if (!input.plan.enabled) return { ok: true, errors };
  if (input.repairLoops > input.plan.maxRepairLoops) {
    errors.push(`repair loop limit exceeded (${input.plan.maxRepairLoops})`);
  }
  if (!input.reviewPassed) errors.push("review gate has not passed");

  const verification = verificationAllowsCompletion(input.verification, {
    runtimeImpact: input.plan.runtimeImpact,
  });
  errors.push(...verification.errors);
  return { ok: errors.length === 0, errors };
}

export function gauntletPrompt(plan: GauntletPlan) {
  if (!plan.enabled) return "";
  const stageList = plan.stages.join(" -> ");
  return [
    `Metis Gauntlet is active (${plan.level}). Lifecycle: ${stageList}.`,
    "Treat these as gates, not a narration checklist: inspect first, make a decision-complete plan, then execute only when the current mode permits mutation.",
    plan.runtimeImpact
      ? "Runtime verification is mandatory: drive the changed behavior through its real surface and record one claim-path observation plus at least one adjacent edge/failure probe. Tests, lint, typecheck and source inspection are supporting evidence, not runtime verification."
      : "This task has no inferred runtime impact; runtime verification may be skipped only with an explicit no-runtime-surface reason.",
    "After verification, review the diff for correctness, removed behavior, caller/callee effects, reuse, unnecessary complexity, efficiency and root-cause depth. Repair real findings, then re-verify affected behavior.",
    `Stop repair cycling after ${plan.maxRepairLoops} loop(s); if a real external blocker remains, report the exact blocker and preserved state instead of pretending completion.`,
  ].join("\n");
}

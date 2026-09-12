export const AGENT_LIFECYCLE_STAGES = [
  "explore",
  "plan",
  "execute",
  "verify",
  "review",
  "repair",
  "done",
] as const;

export type AgentLifecycleStage = (typeof AGENT_LIFECYCLE_STAGES)[number];
export type AgentLifecycleOutcome =
  | "advance"
  | "retry"
  | "needs_repair"
  | "blocked"
  | "complete";

export type AgentStagePolicy = {
  readonly mutatesWorkspace: boolean;
  readonly runtimeObservation: boolean;
  readonly terminal: boolean;
  readonly description: string;
};

export const AGENT_STAGE_POLICY: Record<AgentLifecycleStage, AgentStagePolicy> = {
  explore: {
    mutatesWorkspace: false,
    runtimeObservation: false,
    terminal: false,
    description: "Discover repository and runtime truth before making decisions.",
  },
  plan: {
    mutatesWorkspace: false,
    runtimeObservation: false,
    terminal: false,
    description: "Produce a decision-complete implementation plan from discovered facts.",
  },
  execute: {
    mutatesWorkspace: true,
    runtimeObservation: false,
    terminal: false,
    description: "Implement the planned change without unrelated edits.",
  },
  verify: {
    mutatesWorkspace: false,
    runtimeObservation: true,
    terminal: false,
    description: "Exercise the changed behavior through its real user/programmatic surface.",
  },
  review: {
    mutatesWorkspace: false,
    runtimeObservation: false,
    terminal: false,
    description: "Review correctness, removed behavior, cross-file effects, reuse and root cause.",
  },
  repair: {
    mutatesWorkspace: true,
    runtimeObservation: false,
    terminal: false,
    description: "Repair verified or reviewed defects only.",
  },
  done: {
    mutatesWorkspace: false,
    runtimeObservation: false,
    terminal: true,
    description: "All required gates are satisfied.",
  },
};

const TRANSITIONS: Record<AgentLifecycleStage, readonly AgentLifecycleStage[]> = {
  explore: ["plan", "done"],
  plan: ["execute", "done"],
  execute: ["verify", "review"],
  verify: ["review", "repair"],
  review: ["repair", "done"],
  repair: ["verify", "review"],
  done: [],
};

export function normalizeAgentLifecycleStage(value: unknown): AgentLifecycleStage {
  return typeof value === "string" &&
    (AGENT_LIFECYCLE_STAGES as readonly string[]).includes(value)
    ? (value as AgentLifecycleStage)
    : "explore";
}

export function canTransitionAgentStage(
  from: AgentLifecycleStage,
  to: AgentLifecycleStage,
) {
  return TRANSITIONS[from].includes(to);
}

export function agentStageAllowsMutation(stage: AgentLifecycleStage) {
  return AGENT_STAGE_POLICY[stage].mutatesWorkspace;
}

export function agentStageNeedsRuntimeObservation(stage: AgentLifecycleStage) {
  return AGENT_STAGE_POLICY[stage].runtimeObservation;
}

export function isAgentLifecycleTerminal(stage: AgentLifecycleStage) {
  return AGENT_STAGE_POLICY[stage].terminal;
}

export function transitionAgentStage(
  stage: AgentLifecycleStage,
  outcome: AgentLifecycleOutcome,
): AgentLifecycleStage {
  if (stage === "done" || outcome === "blocked") return stage;
  if (outcome === "retry") return stage;
  if (outcome === "needs_repair") {
    return canTransitionAgentStage(stage, "repair") ? "repair" : stage;
  }
  if (outcome === "complete") {
    return canTransitionAgentStage(stage, "done") ? "done" : stage;
  }

  const preferred: Partial<Record<AgentLifecycleStage, AgentLifecycleStage>> = {
    explore: "plan",
    plan: "execute",
    execute: "verify",
    verify: "review",
    review: "done",
    repair: "verify",
  };
  const next = preferred[stage];
  return next && canTransitionAgentStage(stage, next) ? next : stage;
}

export type TaskKind =
  | "question"
  | "lookup"
  | "edit"
  | "debug"
  | "research"
  | "large";

export type TaskRoute = {
  kind: TaskKind;
  initialSteps: number;
  maxSteps: number;
  parallelizable: boolean;
  usefulTools: string[];
};

const EDIT_WORDS = /\b(implement|build|fix|edit|change|refactor|add|remove|reparier|baue|ändere|fixe|umsetzen)\b/i;
const DEBUG_WORDS = /\b(bug|broken|error|fail|crash|debug|kaputt|fehler|problem)\b/i;
const RESEARCH_WORDS = /\b(research|research|compare|analyse|analyze|prüf|recherch|doku|documentation)\b/i;
const LOOKUP_WORDS = /\b(what|which|how much|status|list|was|welche|wie viel|liste|status)\b/i;

export function routeTask(message: string): TaskRoute {
  const text = String(message || "").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const sections = (text.match(/\n\s*(?:[-*]|\d+[.)])\s+/g) || []).length;
  const files = (text.match(/`[^`\n]+\.[A-Za-z0-9]+`/g) || []).length;
  const large = text.length >= 2_500 || sections >= 8 || files >= 6;
  if (large) {
    return {
      kind: "large",
      initialSteps: 24,
      maxSteps: 80,
      parallelizable: sections >= 3 || files >= 3,
      usefulTools: ["repo_search", "inspect_codebase", "read_file", "edit_file", "execute_command", "verify_changes"],
    };
  }
  if (EDIT_WORDS.test(text) && DEBUG_WORDS.test(text)) {
    return {
      kind: "debug",
      initialSteps: 16,
      maxSteps: 50,
      parallelizable: false,
      usefulTools: ["list_recent_errors", "repo_search", "read_file", "edit_file", "execute_command", "verify_changes"],
    };
  }
  if (EDIT_WORDS.test(text)) {
    return {
      kind: "edit",
      initialSteps: 12,
      maxSteps: 40,
      parallelizable: files >= 2,
      usefulTools: ["repo_search", "read_file", "edit_file", "execute_command", "verify_changes"],
    };
  }
  if (RESEARCH_WORDS.test(text)) {
    return {
      kind: "research",
      initialSteps: 12,
      maxSteps: 32,
      parallelizable: words >= 40,
      usefulTools: ["repo_search", "inspect_codebase", "read_file", "search_tools"],
    };
  }
  if (LOOKUP_WORDS.test(text) && words <= 30) {
    return {
      kind: "lookup",
      initialSteps: 6,
      maxSteps: 16,
      parallelizable: false,
      usefulTools: ["repo_search", "read_file"],
    };
  }
  return {
    kind: "question",
    initialSteps: 4,
    maxSteps: 12,
    parallelizable: false,
    usefulTools: ["read_file"],
  };
}

export function growStepBudget(route: TaskRoute, usedSteps: number, madeProgress: boolean): number {
  const used = Math.max(0, Math.floor(usedSteps));
  if (!madeProgress) return Math.min(route.maxSteps, Math.max(route.initialSteps, used));
  const growth = route.kind === "large" ? 16 : 8;
  return Math.min(route.maxSteps, Math.max(route.initialSteps, used + growth));
}

export type LoopObservation = {
  signature: string;
  progressed: boolean;
  failed: boolean;
};

export class LoopGuard {
  private readonly seen = new Map<string, number>();
  private failures = 0;
  private noProgress = 0;

  observe(input: LoopObservation) {
    const signature = input.signature.trim().slice(0, 500);
    const repeats = signature ? (this.seen.get(signature) || 0) + 1 : 0;
    if (signature) this.seen.set(signature, repeats);
    if (input.failed) this.failures += 1;
    if (input.progressed) this.noProgress = 0;
    else this.noProgress += 1;
    return {
      repeats,
      failures: this.failures,
      noProgress: this.noProgress,
      shouldStop: repeats >= 3 || this.failures >= 4 || this.noProgress >= 6,
      reason: repeats >= 3
        ? "repeated_tool_call"
        : this.failures >= 4
          ? "repeated_failures"
          : this.noProgress >= 6
            ? "no_progress"
            : null,
    };
  }
}

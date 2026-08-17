/**
 * Context-aware model routing for the "auto" model selection.
 *
 * Pure, unit-testable decision function: given a task description, the list of
 * candidate models, and optional passive telemetry signals, pick the model key
 * that best matches the task shape:
 *
 *   - short/simple tasks          → fast/cheap models
 *   - complex / code / reasoning  → high-tier models
 *   - large-context tasks         → models with the biggest context window
 *
 * No database or provider access happens here — callers gather inputs and
 * apply permissions; this module only scores and picks.
 */

import { contextWindowForModel } from "@/lib/context-window";

export type RoutingModel = {
  /** Full chat model key (providerKey[:connectionId]:modelId). */
  key: string;
  id?: string;
  displayName?: string;
  contextWindow?: number;
  tags?: string[];
};

export type RoutingSignals = {
  /** Passive performance summaries keyed by model key (from model_signals). */
  byModel?: Record<string, {
    /** Composite quality score (0-1, higher is better). */
    compositeScore?: number;
    successRate?: number;
    /** Average time-to-first-token in ms (lower is faster). */
    avgTimeToFirstTokenMs?: number;
    /** Average total latency in ms (lower is faster). */
    avgLatencyMs?: number;
    /** Number of recorded runs backing these numbers. */
    totalRuns?: number;
  }>;
};

export type TaskProfile = {
  /** "simple" | "complex" | "long-context" */
  shape: "simple" | "complex" | "long-context";
  /** Rough token estimate of the work (prompt + expected material). */
  approxTokens: number;
  /** True when the task is code/debug/refactor shaped. */
  codeFocused: boolean;
};

const CODE_HINTS =
  /\b(code|coding|refactor|debug|fix|bug|stack ?trace|error|typescript|python|rust|compile|build|implement|api|sql|regex|test)\b/i;
const COMPLEX_HINTS =
  /\b(architect|design|analy[sz]e|compare|research|plan|strategy|detailed|comprehensive|deep|reason|review|optimi[sz]e|migrat|rewrite|why)\b/i;
const SIMPLE_HINTS =
  /^(hi|hey|hello|thanks|thank you|ok|okay|great|sure|yes|no|done|please|quick|short|summarize|tl;?dr|list)\b/i;

const LONG_CONTEXT_TOKENS = 120_000;

/** Heuristically classify a task description. Exported for testing. */
export function profileTask(
  taskDescription: string,
  contextTokens?: number,
): TaskProfile {
  const text = (taskDescription || "").trim();
  const approxTokens = Math.max(
    Math.ceil(text.length / 4),
    typeof contextTokens === "number" && Number.isFinite(contextTokens) ? contextTokens : 0,
  );
  const codeFocused = CODE_HINTS.test(text);
  const complex = COMPLEX_HINTS.test(text) || codeFocused;
  const simple = !complex && (SIMPLE_HINTS.test(text) || text.length < 120);
  const shape: TaskProfile["shape"] =
    approxTokens >= LONG_CONTEXT_TOKENS
      ? "long-context"
      : complex
        ? "complex"
        : simple
          ? "simple"
          : "complex";
  return { shape, approxTokens, codeFocused };
}

function tagsOf(model: RoutingModel): string {
  return [...(model.tags || []), model.id || "", model.displayName || ""].join(" ").toLowerCase();
}

function isFastModel(model: RoutingModel): boolean {
  return /\b(fast|mini|flash|lite|turbo|haiku|small|instant|air)\b/.test(tagsOf(model));
}

function isHighTierModel(model: RoutingModel): boolean {
  return /\b(pro|opus|max|ultra|thinking|reasoning|large|frontier|heavy)\b/.test(tagsOf(model));
}

function isCodingModel(model: RoutingModel): boolean {
  return /\b(cod(e|er|ex)|coding)\b/.test(tagsOf(model));
}

function contextOf(model: RoutingModel): number {
  return contextWindowForModel({
    id: model.id,
    displayName: model.displayName,
    contextWindow: model.contextWindow,
  }) || 0;
}

/**
 * Pick the best model key for a task. Returns null when `models` is empty or
 * (for long-context tasks) when no candidate has a context window big enough.
 */
export function routeModel(
  taskDescription: string,
  models: RoutingModel[],
  signals?: RoutingSignals,
): string | null {
  if (!models.length) return null;
  const profile = profileTask(taskDescription);

  const scored = models.map((model) => {
    let score = 0;
    const context = contextOf(model);

    if (profile.shape === "simple") {
      if (isFastModel(model)) score += 3;
      if (isHighTierModel(model)) score -= 2;
    } else if (profile.shape === "complex") {
      if (isHighTierModel(model)) score += 3;
      if (profile.codeFocused && isCodingModel(model)) score += 2;
      if (isFastModel(model) && !isCodingModel(model)) score -= 1;
    } else {
      // long-context: strongly prefer the largest window, penalize overflow.
      score += context > 0 ? Math.min(4, Math.log10(Math.max(context, 1)) - 4.5) : -3;
      if (context > 0 && context < profile.approxTokens) score -= 5;
      if (isHighTierModel(model)) score += 1;
    }

    // Telemetry nudge (weak prior; never overrides the task shape).
    const signal = signals?.byModel?.[model.key];
    if (signal) {
      const sampleWeight = Math.min(1, (signal.totalRuns || 0) / 10);
      if (typeof signal.compositeScore === "number") {
        score += 1.5 * signal.compositeScore * sampleWeight;
      }
      if (typeof signal.successRate === "number") {
        score += 0.75 * (signal.successRate - 0.5) * sampleWeight;
      }
      if (profile.shape === "simple" && typeof signal.avgTimeToFirstTokenMs === "number" && signal.avgTimeToFirstTokenMs > 0) {
        // Faster first token is worth up to ~1 point for simple tasks.
        score += Math.max(-0.5, Math.min(1, 4_000 / signal.avgTimeToFirstTokenMs - 0.5)) * sampleWeight;
      }
    }

    return { key: model.key, context, score };
  });

  scored.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const best = scored[0];

  if (profile.shape === "long-context" && best.context > 0 && best.context < profile.approxTokens) {
    return null;
  }
  return best.key;
}

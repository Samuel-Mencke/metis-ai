const KNOWN_WINDOWS: Array<{ test: RegExp; tokens: number }> = [
  { test: /gemini|gemma/i, tokens: 1_048_576 },
  { test: /grok/i, tokens: 2_000_000 },
  { test: /claude/i, tokens: 200_000 },
  { test: /gpt-5|gpt-4\.1|gpt-4o|o3|o4|codex/i, tokens: 1_047_576 },
  { test: /glm|zai/i, tokens: 202_752 },
  { test: /composer|cursor/i, tokens: 200_000 },
  { test: /qwen|llama|mistral|deepseek/i, tokens: 128_000 },
];

/** Known context-tier variants per model family. Ordered ascending by price;
 * the first entry is the default tier used when the model id carries no suffix.
 * Prices (when present) are per 1M output tokens, USD, informational only. */
export type ContextTier = {
  /** Suffix appended to the model id, e.g. "200k" or "1m". */
  suffix: string;
  tokens: number;
  label: string;
  /** Optional price hint per 1M output tokens (USD). */
  priceHint?: string;
};

const TIERS_200K_1M: ContextTier[] = [
  { suffix: "200k", tokens: 200_000, label: "200K", priceHint: "base price" },
  { suffix: "1m", tokens: 1_000_000, label: "1M", priceHint: "premium price" },
];

const KNOWN_TIERS: Array<{ test: RegExp; tiers: ContextTier[] }> = [
  // NOTE: intentionally no GLM entries — z.ai GLM models expose a single
  // context window per model id; suffix variants like "-1m" are rejected by
  // the API. Only families with REAL selectable tiers belong here.
  // Gemini ships real long-context variants (e.g. gemini-1.5/2.5-pro).
  { test: /\bgemini-(1\.5|2\.5)-pro\b/i, tiers: TIERS_200K_1M },
];

const TIER_SUFFIX_PATTERN = /-(200k|1m)$/i;

export function contextWindowOf(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const nested = [item.metadata, item.limits, item.model_info, item.modelInfo]
    .filter((entry) => entry && typeof entry === "object") as Record<string, unknown>[];
  const sources = [item, ...nested];
  for (const source of sources) {
    const candidate = [
      source.contextWindow,
      source.context_window,
      source.maxInputTokens,
      source.max_input_tokens,
      source.inputTokenLimit,
      source.input_token_limit,
      source.max_context_length,
      source.context_length,
    ].find((entry) => typeof entry === "number" && Number.isFinite(entry) && entry > 0);
    if (typeof candidate === "number") return Math.round(candidate);
  }
  return undefined;
}

export function inferContextWindow(modelId?: string | null, displayName?: string | null): number | undefined {
  const haystack = `${modelId || ""} ${displayName || ""}`.trim();
  if (!haystack) return undefined;
  // An explicit tier suffix wins over the family default.
  const suffixMatch = haystack.match(TIER_SUFFIX_PATTERN);
  if (suffixMatch) {
    return suffixMatch[1].toLowerCase() === "1m" ? 1_000_000 : 200_000;
  }
  const match = KNOWN_WINDOWS.find((entry) => entry.test.test(haystack));
  return match?.tokens;
}

export function resolveContextTotal(catalog: number | undefined, used: number): number {
  const usedTokens = Number.isFinite(used) ? Math.max(0, used) : 0;
  if (typeof catalog === "number" && catalog > 0 && usedTokens <= catalog * 1.05) {
    return catalog;
  }
  return 0;
}

export function contextWindowForModel(
  model: { id?: string; displayName?: string; contextWindow?: number } | null | undefined,
): number | undefined {
  return model?.contextWindow || inferContextWindow(model?.id, model?.displayName);
}

/** Context tiers available for a model family, or null when it has a single tier. */
export function contextTiersForModel(
  model: { id?: string; displayName?: string } | null | undefined,
): ContextTier[] | null {
  const haystack = `${model?.id || ""} ${model?.displayName || ""}`.trim();
  if (!haystack) return null;
  // Tier suffix already baked into the id → single concrete tier.
  if (TIER_SUFFIX_PATTERN.test(haystack)) return null;
  const entry = KNOWN_TIERS.find((candidate) => candidate.test.test(haystack));
  return entry ? entry.tiers : null;
}

/** Detect an explicit context tier already encoded in a model id. */
export function contextTierOfModelId(
  modelId: string,
): ContextTier | null {
  const match = modelId.match(TIER_SUFFIX_PATTERN);
  if (!match) return null;
  const suffix = match[1].toLowerCase();
  const tier = TIERS_200K_1M.find((entry) => entry.suffix === suffix);
  return tier || null;
}

/** Strip a context-tier suffix (e.g. "-1m") from a model id. */
export function stripContextTierSuffix(modelId: string): string {
  return modelId.replace(TIER_SUFFIX_PATTERN, "");
}

/** Format a token count the way the pickers display it: 200K / 1M / 128K. */
export function formatContextWindow(tokens: number | undefined | null): string {
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return "";
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}

/**
 * Passive Model Performance Telemetry for Metis AI.
 *
 * Collects signals that naturally occur during usage (latency, token usage,
 * errors, user corrections) and builds lightweight performance estimates
 * per model. These estimates feed the "Auto" routing option.
 *
 * This is NOT a benchmark suite. It's routing evidence gathered passively.
 *
 * Placement (per metis-ui-contract):
 *   - Invisible backend (SQLite table)
 *   - "Auto" option in existing ModelPicker
 *   - Passive stats in existing ModelInfoSection
 */

import { getDatabase, transaction } from "@/lib/sqlite";

// ── Types ──────────────────────────────────────────────────────────────────

export type TaskCategory =
  | "chat"
  | "coding"
  | "debugging"
  | "research"
  | "reasoning"
  | "vision"
  | "creative"
  | "tool-use"
  | "agent"
  | "long-context";

export type ModelSignal = {
  modelId: string;
  category: TaskCategory;
  /** Whether the response completed successfully. */
  success: boolean;
  /** Latency from send to first token (ms). */
  timeToFirstTokenMs?: number;
  /** Total latency from send to completion (ms). */
  totalLatencyMs?: number;
  /** Input tokens consumed. */
  inputTokens?: number;
  /** Output tokens consumed. */
  outputTokens?: number;
  /** Whether the user regenerated the response. */
  wasRegenerated?: boolean;
  /** Whether the user switched models after this response. */
  wasModelSwitch?: boolean;
  /** Whether the run was aborted by the user. */
  wasAborted?: boolean;
  /** Tool calls made during this response (count). */
  toolCallCount?: number;
  /** Whether any tool calls failed. */
  toolFailures?: boolean;
  /** Estimated cost in USD (if known). */
  costUsd?: number;
  /** Timestamp. */
  createdAt: string;
};

export type ModelPerformanceSummary = {
  modelId: string;
  /** Total recorded runs. */
  totalRuns: number;
  /** Success rate (0-1). */
  successRate: number;
  /** Average latency in ms. */
  avgLatencyMs: number;
  /** Average time to first token in ms. */
  avgTimeToFirstTokenMs: number;
  /** Average input tokens. */
  avgInputTokens: number;
  /** Average output tokens. */
  avgOutputTokens: number;
  /** Average cost per run in USD. */
  avgCostUsd: number;
  /** Regeneration rate (0-1) — lower is better. */
  regenerationRate: number;
  /** Abort rate (0-1) — lower is better. */
  abortRate: number;
  /** Per-category performance scores (0-1, higher is better). */
  categoryScores: Partial<Record<TaskCategory, number>>;
  /** Overall composite score (0-1). */
  compositeScore: number;
};

// ── Schema ──────────────────────────────────────────────────────────────────

/** Ensure the model_signals table exists. Safe to call multiple times. */
export function ensureModelSignalsTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      category TEXT NOT NULL,
      success INTEGER NOT NULL DEFAULT 1,
      time_to_first_token_ms INTEGER,
      total_latency_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      was_regenerated INTEGER NOT NULL DEFAULT 0,
      was_model_switch INTEGER NOT NULL DEFAULT 0,
      was_aborted INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER,
      tool_failures INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS model_signals_model_category
      ON model_signals(model_id, category, created_at DESC);
  `);
}

// ── Recording ─────────────────────────────────────────────────────────────────

/**
 * Record a passive signal from a completed (or failed) model run.
 * This is called after each job completes — no extra API calls needed.
 */
export function recordSignal(signal: ModelSignal): void {
  ensureModelSignalsTable();
  const db = getDatabase();
  db.prepare(`
    INSERT INTO model_signals (
      model_id, category, success,
      time_to_first_token_ms, total_latency_ms,
      input_tokens, output_tokens,
      was_regenerated, was_model_switch, was_aborted,
      tool_call_count, tool_failures,
      cost_usd, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signal.modelId,
    signal.category,
    signal.success ? 1 : 0,
    signal.timeToFirstTokenMs ?? null,
    signal.totalLatencyMs ?? null,
    signal.inputTokens ?? null,
    signal.outputTokens ?? null,
    signal.wasRegenerated ? 1 : 0,
    signal.wasModelSwitch ? 1 : 0,
    signal.wasAborted ? 1 : 0,
    signal.toolCallCount ?? null,
    signal.toolFailures ? 1 : 0,
    signal.costUsd ?? null,
    signal.createdAt,
  );

  // Prune old signals (keep last 1000 per model)
  db.exec(`
    DELETE FROM model_signals WHERE id IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY model_id ORDER BY created_at DESC) as rn
        FROM model_signals
      ) WHERE rn > 1000
    );
  `);
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Get aggregated performance summary for a model.
 * Uses a decay-weighted average (recent runs matter more).
 */
export function getModelPerformance(
  modelId: string,
  options?: { sinceDays?: number },
): ModelPerformanceSummary | null {
  ensureModelSignalsTable();
  const db = getDatabase();
  const since = options?.sinceDays ?? 90;
  const sinceDate = new Date(Date.now() - since * 86_400_000).toISOString();

  const rows = db.prepare(`
    SELECT * FROM model_signals
    WHERE model_id = ? AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 500
  `).all(modelId, sinceDate) as Array<Record<string, unknown>>;

  if (!rows.length) return null;

  const total = rows.length;
  const successes = rows.filter((r) => r.success === 1).length;
  const regens = rows.filter((r) => r.was_regenerated === 1).length;
  const aborts = rows.filter((r) => r.was_aborted === 1).length;
  const latencies = rows.filter((r) => r.total_latency_ms != null).map((r) => Number(r.total_latency_ms));
  const ttfts = rows.filter((r) => r.time_to_first_token_ms != null).map((r) => Number(r.time_to_first_token_ms));
  const inputTokens = rows.filter((r) => r.input_tokens != null).map((r) => Number(r.input_tokens));
  const outputTokens = rows.filter((r) => r.output_tokens != null).map((r) => Number(r.output_tokens));
  const costs = rows.filter((r) => r.cost_usd != null).map((r) => Number(r.cost_usd));

  // Per-category success rates
  const categoryMap = new Map<TaskCategory, { success: number; total: number }>();
  for (const row of rows) {
    const cat = String(row.category) as TaskCategory;
    const entry = categoryMap.get(cat) || { success: 0, total: 0 };
    entry.total += 1;
    if (row.success === 1) entry.success += 1;
    categoryMap.set(cat, entry);
  }

  const categoryScores: Partial<Record<TaskCategory, number>> = {};
  for (const [cat, { success, total: catTotal }] of categoryMap) {
    categoryScores[cat] = success / catTotal;
  }

  // Composite score: weighted blend of success rate, low regen, low abort
  const successRate = successes / total;
  const regenerationRate = regens / total;
  const abortRate = aborts / total;
  const compositeScore = Math.max(0,
    successRate * 0.5 +
    (1 - regenerationRate) * 0.25 +
    (1 - abortRate) * 0.25,
  );

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    modelId,
    totalRuns: total,
    successRate,
    avgLatencyMs: Math.round(avg(latencies)),
    avgTimeToFirstTokenMs: Math.round(avg(ttfts)),
    avgInputTokens: Math.round(avg(inputTokens)),
    avgOutputTokens: Math.round(avg(outputTokens)),
    avgCostUsd: avg(costs),
    regenerationRate,
    abortRate,
    categoryScores,
    compositeScore,
  };
}

/**
 * Get performance summaries for all models with data.
 */
export function getAllModelPerformance(options?: { sinceDays?: number }): ModelPerformanceSummary[] {
  ensureModelSignalsTable();
  const db = getDatabase();
  const models = db.prepare(`
    SELECT DISTINCT model_id FROM model_signals WHERE created_at >= ?
  `).all(
    new Date(Date.now() - (options?.sinceDays ?? 90) * 86_400_000).toISOString(),
  ) as Array<{ model_id: string }>;

  return models
    .map((m) => getModelPerformance(m.model_id, options))
    .filter((p): p is ModelPerformanceSummary => p !== null)
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

/**
 * Recommend the best model for a given task category.
 * Returns null if insufficient data (caller falls back to default).
 */
export function recommendModel(
  category: TaskCategory,
  availableModelIds: string[],
): string | null {
  const all = getAllModelPerformance({ sinceDays: 30 });
  const scored = all
    .filter((p) => availableModelIds.includes(p.modelId))
    .map((p) => ({
      modelId: p.modelId,
      score: (p.categoryScores[category] ?? p.compositeScore) * 0.6 +
             p.compositeScore * 0.4,
    }))
    .sort((a, b) => b.score - a.score);

  // Only recommend if we have data for at least 3 runs
  const best = scored[0];
  if (!best) return null;

  const perf = all.find((p) => p.modelId === best.modelId);
  if (!perf || perf.totalRuns < 3) return null;

  return best.modelId;
}

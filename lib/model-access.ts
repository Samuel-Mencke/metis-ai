import { getDatabase } from "@/lib/sqlite";
import {
  findActiveConnection,
  getProviderConnection,
  getProviderConnectionSecret,
  listProviderModels,
} from "@/lib/provider-connections";
import { scheduleProviderModelRefresh } from "@/lib/providers/discovery";
import { providerModelIdsMatch } from "@/lib/providers/model-aliases";
import { parseModelKey } from "@/lib/providers/types";

const ALL_MODELS = "*";

export function ensureAllModelAccess(userId: string) {
  getDatabase().prepare(
    `INSERT OR IGNORE INTO user_model_permissions (user_id, model_id, created_at)
     VALUES (?, ?, ?)`,
  ).run(userId, ALL_MODELS, new Date().toISOString());
}

export function isModelAllowed(userId: string | undefined, modelId: string) {
  if (!userId) return false;

  const parsed = parseModelKey(modelId);
  if (!parsed.modelId.trim()) return false;

  // Wildcard permission still requires an enabled provider connection.
  // Alias-match or refresh-on-miss so a stale provider_models cache does not
  // reject newly discovered IDs.
  if (parsed.providerKey !== "cursor") {
    const connection = parsed.connectionId
      ? getProviderConnection(parsed.connectionId, userId)
      : findActiveConnection(userId, parsed.providerKey);
    if (!connection?.enabled || connection.providerKey !== parsed.providerKey) return false;
    const discovered = listProviderModels(connection.id);
    if (
      discovered.length > 0
      && !discovered.some((model) => providerModelIdsMatch(parsed.providerKey, parsed.modelId, model.id))
    ) {
      const secretConnection = getProviderConnectionSecret(connection.id, userId);
      if (secretConnection?.enabled) void scheduleProviderModelRefresh(secretConnection);
      else return false;
    }
  }

  const row = getDatabase().prepare(
    `SELECT 1
     FROM user_model_permissions
     WHERE user_id = ? AND (model_id = ? OR model_id = ?)
     LIMIT 1`,
  ).get(userId, modelId, ALL_MODELS);
  if (row) return true;

  if (parsed.providerKey === "cursor") return false;
  const connection = parsed.connectionId
    ? getProviderConnection(parsed.connectionId, userId)
    : findActiveConnection(userId, parsed.providerKey);
  return Boolean(connection?.enabled && connection.providerKey === parsed.providerKey);
}

export function filterAllowedModels<T extends { id: string }>(userId: string | undefined, models: T[]) {
  if (!userId) return [];
  const rows = getDatabase().prepare(
    "SELECT model_id as modelId FROM user_model_permissions WHERE user_id = ?",
  ).all(userId) as Array<{ modelId: string }>;
  const allowed = new Set(rows.map((row) => row.modelId));
  if (allowed.has(ALL_MODELS)) return models;
  return models.filter((model) => allowed.has(model.id));
}

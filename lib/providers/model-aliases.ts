const COMPATIBLE_LEGACY_MODEL_IDS: Record<string, string> = {
  "glm5.2": "glm-5.2",
  "glm-5.2": "glm-5.2",
  glm52: "glm-5.2",
  "glm5.3": "glm-5.3",
  "glm-5.3": "glm-5.3",
  glm53: "glm-5.3",
  "glm5.1": "glm-5.1",
  "glm-5.1": "glm-5.1",
  glm51: "glm-5.1",
  glm5: "glm-5",
  "glm-5": "glm-5",
  "glm-samuel": "glm-samuel",
  glmsamuel: "glm-samuel",
  glm_samuel: "glm-samuel",
  "glm.samuel": "glm-samuel",
};

export function compactProviderModelId(modelId: string) {
  return modelId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeLegacyProviderModelId(providerKey: string, modelId: string) {
  if (providerKey !== "compatible") return modelId;
  const trimmed = modelId.trim();
  if (!trimmed) return modelId;
  const lower = trimmed.toLowerCase();
  if (COMPATIBLE_LEGACY_MODEL_IDS[lower]) return COMPATIBLE_LEGACY_MODEL_IDS[lower];
  const compact = compactProviderModelId(trimmed);
  if (COMPATIBLE_LEGACY_MODEL_IDS[compact]) return COMPATIBLE_LEGACY_MODEL_IDS[compact];
  if (compact.startsWith("glmsamuel")) return "glm-samuel";
  return modelId;
}

export function providerModelIdsMatch(providerKey: string, left: string, right: string) {
  if (left === right) return true;
  const canonicalLeft = normalizeLegacyProviderModelId(providerKey, left);
  const canonicalRight = normalizeLegacyProviderModelId(providerKey, right);
  if (canonicalLeft === canonicalRight) return true;
  const compactLeft = compactProviderModelId(canonicalLeft);
  const compactRight = compactProviderModelId(canonicalRight);
  if (compactLeft && compactLeft === compactRight) return true;
  return compactLeft.startsWith("glmsamuel") && compactRight.startsWith("glmsamuel");
}

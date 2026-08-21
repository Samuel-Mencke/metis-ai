import assert from "node:assert/strict";
import test from "node:test";
import {
  compactProviderModelId,
  normalizeLegacyProviderModelId,
  providerModelIdsMatch,
} from "../lib/providers/model-aliases";

test("normalizeLegacyProviderModelId maps glm compact ids on compatible", () => {
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm5.2"), "glm-5.2");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm-5.2"), "glm-5.2");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm52"), "glm-5.2");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm5.3"), "glm-5.3");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm5.1"), "glm-5.1");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm5"), "glm-5");
  assert.equal(normalizeLegacyProviderModelId("openai", "glm5.2"), "glm5.2");
});

test("normalizeLegacyProviderModelId maps glm-samuel compact prefixes", () => {
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm-samuel"), "glm-samuel");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glmsamuel"), "glm-samuel");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm_samuel"), "glm-samuel");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm.samuel"), "glm-samuel");
  assert.equal(normalizeLegacyProviderModelId("compatible", "glm-samuel-fast"), "glm-samuel");
  assert.equal(compactProviderModelId("glm-samuel-fast").startsWith("glmsamuel"), true);
});

test("providerModelIdsMatch treats glm aliases as the same model", () => {
  assert.equal(providerModelIdsMatch("compatible", "glm5.2", "glm-5.2"), true);
  assert.equal(providerModelIdsMatch("compatible", "glm5.3", "glm-5.3"), true);
  assert.equal(providerModelIdsMatch("compatible", "glm5.1", "glm-5.1"), true);
  assert.equal(providerModelIdsMatch("compatible", "glm5", "glm-5"), true);
  assert.equal(providerModelIdsMatch("compatible", "glm-samuel-fast", "glmsamuel"), true);
  assert.equal(providerModelIdsMatch("compatible", "glm-5.2", "glm-5.3"), false);
});

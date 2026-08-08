import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/secrets";
import { listProviderDefinitions } from "../lib/providers/registry";
import { modelKey, parseModelKey } from "../lib/providers/types";

process.env.AI_CHAT_SECRETS_KEY = "00".repeat(32);

test("provider credentials round-trip through authenticated encryption", () => {
  const plaintext = "provider-secret-value";
  const encrypted = encryptSecret(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptSecret(encrypted), plaintext);
  assert.equal(maskSecret(plaintext), "prov••••alue");
});

test("invalid secret key material fails closed", () => {
  const previous = process.env.AI_CHAT_SECRETS_KEY;
  process.env.AI_CHAT_SECRETS_KEY = "not-a-key";
  assert.throws(() => encryptSecret("secret"), /must decode to exactly 32 bytes/);
  process.env.AI_CHAT_SECRETS_KEY = previous;
});

test("model keys remain compatible with legacy Cursor IDs", () => {
  assert.deepEqual(parseModelKey("composer-2.5"), {
    providerKey: "cursor",
    modelId: "composer-2.5",
  });
  assert.deepEqual(parseModelKey("openai:gpt-5"), {
    providerKey: "openai",
    modelId: "gpt-5",
  });
  assert.deepEqual(parseModelKey("openai:connection-1:gpt-5"), {
    providerKey: "openai",
    connectionId: "connection-1",
    modelId: "gpt-5",
  });
  assert.equal(modelKey("cursor", "composer-2.5"), "composer-2.5");
  assert.equal(modelKey("openrouter", "anthropic/claude-sonnet-4-6"), "openrouter:anthropic/claude-sonnet-4-6");
  assert.equal(modelKey("openai", "gpt-5", "connection-1"), "openai:connection-1:gpt-5");
});

test("registry includes native and generic provider paths", () => {
  const keys = new Set(listProviderDefinitions().map((provider) => provider.key));
  for (const key of ["cursor", "openai", "anthropic", "google", "xai", "openrouter", "ollama", "compatible", "codex", "claude-code", "antigravity"]) {
    assert.equal(keys.has(key), true, `missing provider ${key}`);
  }
});

test("agent providers use OAuth exclusively", () => {
  for (const key of ["codex", "claude-code", "antigravity"]) {
    const provider = listProviderDefinitions().find((item) => item.key === key);
    assert.deepEqual(provider?.authTypes, ["oauth"], `${key} should only allow OAuth`);
  }
});

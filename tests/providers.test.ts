import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret, maskSecret } from "../lib/secrets";
import { listProviderDefinitions } from "../lib/providers/registry";
import { codexTool } from "../lib/providers/runner";
import { antigravitySupportsEffort } from "../lib/providers/official-antigravity";
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

test("Codex exposes the supported credential paths and official model IDs", () => {
  const provider = listProviderDefinitions().find((item) => item.key === "codex");
  assert.deepEqual(provider?.authTypes, ["oauth", "account", "api_key"]);
  assert.deepEqual(provider?.models.map((model) => model.id), [
    "gpt-5.6",
    "gpt-5.3-codex",
    "gpt-5.2",
  ]);
});

test("Codex tool events preserve command and MCP results", () => {
  assert.deepEqual(
    codexTool({
      id: "cmd-1",
      type: "command_execution",
      command: "pwd",
      aggregated_output: "/workspace\n",
      status: "completed",
    }),
    {
      id: "cmd-1",
      name: "Codex command",
      status: "completed",
      kind: "shell",
      input: JSON.stringify("pwd"),
      result: "/workspace\n",
    },
  );
  assert.match(
    codexTool({
      id: "mcp-1",
      type: "mcp_tool_call",
      server: "metis",
      tool: "read_file",
      arguments: { path: "README.md" },
      result: { structured_content: { content: "ok" } },
    })?.result || "",
    /structured_content/,
  );
});

test("Antigravity does not send effort for Claude models", () => {
  assert.equal(antigravitySupportsEffort("gemini-3.6-flash"), true);
  assert.equal(antigravitySupportsEffort("gpt-oss-120b-medium"), true);
  assert.equal(antigravitySupportsEffort("claude-opus-4-6-thinking"), false);
});

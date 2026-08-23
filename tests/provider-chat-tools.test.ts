import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { modelSupportsChatTools } from "../lib/providers/discovery";

test("chat models keep tool support; embeddings/tts/whisper do not", () => {
  assert.equal(modelSupportsChatTools("gpt-5.4"), true);
  assert.equal(modelSupportsChatTools("claude-sonnet-4-6"), true);
  assert.equal(modelSupportsChatTools("gpt-4o-mini"), true);
  assert.equal(modelSupportsChatTools("text-embedding-3-large"), false);
  assert.equal(modelSupportsChatTools("whisper-1"), false);
  assert.equal(modelSupportsChatTools("tts-1-hd"), false);
  assert.equal(modelSupportsChatTools("sora-2"), false);
  assert.equal(modelSupportsChatTools("gpt-3.5-turbo-instruct"), false);
});

test("runner dispatches Codex and Claude Code to their MCP agent SDKs", () => {
  const source = readFileSync(new URL("../lib/providers/runner.ts", import.meta.url), "utf8");
  assert.match(source, /execution === "codex-sdk"\) return runCodex/);
  assert.match(source, /execution === "claude-agent"\) return runClaude/);
  assert.match(source, /execution === "antigravity-cli"\) return runAntigravity/);
  assert.doesNotMatch(source, /runOAuthAiSdk\(context, "codex"\)/);
  assert.doesNotMatch(source, /claudeSecretIsJsonOAuth/);
  assert.match(source, /claudeMcpServers\(getMcpServers/);
  assert.match(source, /strictMcpConfig: true/);
});

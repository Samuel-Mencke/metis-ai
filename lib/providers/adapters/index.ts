import type { ProviderExecution } from "@/lib/providers/run-kind";
import type { ProviderAdapterShape } from "./contract";
import { aiSdkAdapter } from "./ai-sdk";
import { codexAdapter } from "./codex";
import { claudeAdapter } from "./claude";
import { antigravityAdapter } from "./antigravity";
import type { ProviderAdapter } from "./contract";

const adapters: Record<ProviderExecution, ProviderAdapterShape | undefined> = {
  "ai-sdk": aiSdkAdapter,
  "codex-sdk": codexAdapter,
  "claude-agent": claudeAdapter,
  "antigravity-cli": antigravityAdapter,
  // Cursor, grok and opencode remain on the existing worker/ACP paths until
  // their adapter ports; declared here so the execution map stays exhaustive.
  "cursor-agent": undefined,
  "grok-cli": undefined,
  "opencode-cli": undefined,
};

export function providerAdapterForExecution(
  execution: ProviderExecution,
): ProviderAdapterShape {
  const adapter = adapters[execution];
  if (!adapter) {
    throw new Error(`No provider adapter is available for ${execution}.`);
  }
  return adapter;
}

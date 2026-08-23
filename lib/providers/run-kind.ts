import { getProviderDefinition } from "./registry";

export type ProviderExecution =
  | "cursor-agent"
  | "codex-sdk"
  | "claude-agent"
  | "antigravity-cli"
  | "ai-sdk";

/** Every implemented provider kind must resolve to a runtime that attaches Metis MCP/tools. */
export function providerExecution(providerKey: string): ProviderExecution {
  const kind = getProviderDefinition(providerKey)?.kind;
  if (kind === "cursor-agent") return "cursor-agent";
  if (kind === "codex-agent") return "codex-sdk";
  if (kind === "claude-agent") return "claude-agent";
  if (kind === "antigravity-agent") return "antigravity-cli";
  return "ai-sdk";
}

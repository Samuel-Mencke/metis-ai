/**
 * Provider-neutral control policy. Keep orchestration semantics here so Cursor,
 * AI SDK providers, Codex, Claude Code and Antigravity do not silently drift.
 * Provider adapters should map these semantics to native controls where they
 * exist (for example Cursor `agents` + `task`) and use Metis MCP fallbacks
 * otherwise.
 */
export const METIS_AGENT_CONTROL_VERSION = 1;

export type ToolContractInput = {
  modeId: string;
  toolNames?: ReadonlyArray<string>;
  provider?: string;
  nativeTools?: boolean;
};

export function toolContractPrompt(input: ToolContractInput): string {
  const names = [...new Set((input.toolNames || []).map((name) => name.trim()).filter(Boolean))].sort();
  const surface = names.length
    ? names.join(", ")
    : input.nativeTools
      ? "provider-native tools (the provider decides the exact names)"
      : "no callable tools";
  const planRule = input.modeId === "plan"
    ? "In Plan mode create exactly one plan workspace in the current chat, then update that same plan; do not create plans from subagents."
    : "In Agent mode do not create a plan workspace unless the user explicitly requests a plan document.";
  const todoRule = input.modeId === "agent"
    ? "For three or more distinct steps keep one current Todo state and update it; use the available Todo tool only."
    : input.modeId === "plan"
      ? "Use one short Todo checklist for progress only; the persisted plan workspace is the canonical plan."
      : "Do not create a Todo checklist for a single-step answer.";
  return [
    `Tool contract for this run (${input.provider || "provider"}):`,
    `Callable tools: ${surface}. Never call or promise a tool that is not listed or provider-native.`,
    "Use direct Metis core tools such as read_file, list_directory, execute_command, write_file, browser_* and write_todos when they are listed. Do not invent MCP server IDs such as 'metis'; call_mcp_tool is only for an exact server/tool pair returned by search_tools or list_mcp_servers.",
    planRule,
    todoRule,
            "Tool calls are stateful actions, not narration. Wait for the result, preserve errors, and continue from the returned state.",
        "Prefer Metis MCP / gateway tools over repeating tool names in chat. Native provider tools are a fallback when a Metis tool is not listed. Do not narrate the tool catalog.",
  ].join("\n");
}

export const METIS_SHARED_AGENT_CONTROL = [
  "Metis control contract v1:",
  "- Diagnostics/self-repair: only when the user explicitly asks about Metis itself (fix Metis, read Metis logs/errors): call list_recent_errors first, drill in with read_error_log_detail, and edit/test the repo if asked. Never do this for ordinary task failures. A tool error/timeout during a normal task (browser hung, request timed out, MCP -32001) is a transient infrastructure issue: retry the tool, or reset the browser session with a fresh browser_navigate, then continue the USER'S task. Do not grep/read Metis source code, do not kill system processes, do not spend more than ~2 calls on recovery before resuming the actual task.",
  "- Delegation: delegate bounded independent work instead of copying a giant parent prompt into children. Prefer the provider's native subagent/task primitive when it has one (Cursor task/agents). Otherwise call delegate_subagent, which creates a durable Metis child run. The parent remains coordinator and owns final synthesis.",
  "- Parallel delegation: launch independent delegate_subagent calls with wait=false, keep file ownership non-overlapping, then use subagent_status with the returned agentIds until the required children are terminal before final synthesis. Do not finish while required delegated work is still running.",
  "- Plan/Todo state: plans and todos are current state, not append-only narration. Create one plan, update that same plan with edit_plan, and keep one current write_todos/updateTodos checklist with statuses. Do not create duplicate plan/task surfaces just to report progress.",
].join("\n");

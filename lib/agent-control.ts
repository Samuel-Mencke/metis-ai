/**
 * Provider-neutral control policy. Keep orchestration semantics here so Cursor,
 * AI SDK providers, Codex, Claude Code and Antigravity do not silently drift.
 * Provider adapters should map these semantics to native controls where they
 * exist (for example Cursor `agents` + `task`) and use Metis MCP fallbacks
 * otherwise.
 */
export const METIS_AGENT_CONTROL_VERSION = 1;

export const METIS_SHARED_AGENT_CONTROL = [
  "Metis control contract v1:",
  "- Diagnostics/self-repair: only when the user explicitly asks about Metis itself (fix Metis, read Metis logs/errors): call list_recent_errors first, drill in with read_error_log_detail, and edit/test the repo if asked. Never do this for ordinary task failures. A tool error/timeout during a normal task (browser hung, request timed out, MCP -32001) is a transient infrastructure issue: retry the tool, or reset the browser session with a fresh browser_navigate, then continue the USER'S task. Do not grep/read Metis source code, do not kill system processes, do not spend more than ~2 calls on recovery before resuming the actual task.",
  "- Delegation: delegate bounded independent work instead of copying a giant parent prompt into children. Prefer the provider's native subagent/task primitive when it has one (Cursor task/agents). Otherwise call delegate_subagent, which creates a durable Metis child run. The parent remains coordinator and owns final synthesis.",
  "- Parallel delegation: launch independent delegate_subagent calls with wait=false, keep file ownership non-overlapping, then use subagent_status with the returned agentIds until the required children are terminal before final synthesis. Do not finish while required delegated work is still running.",
  "- Plan/Todo state: plans and todos are current state, not append-only narration. Create one plan, update that same plan with edit_plan, and keep one current write_todos/updateTodos checklist with statuses. Do not create duplicate plan/task surfaces just to report progress.",
].join("\n");

# Metis AI Bug Priority

This list is based on the repository audit, focused tests, live systemd state,
SQLite integrity checks, and service journal evidence collected on August 20,
2026.

## Critical

- MCP bearer authentication accepts caller-supplied user, chat, and job
  headers, allowing a token holder to impersonate another account.
- `call_mcp_tool` checks policy only for the wrapper and can invoke a child MCP
  tool without applying the child tool's permission category.
- Heavy automation/browser/MCP jobs share the entire worker pool and can
  starve normal interactive chats.
- Browser WebSocket setup can reject after the browser/page has already closed,
  producing unhandled rejections in the production server.
- Worker restart recovery requeues every running job regardless of age, which
  can duplicate a still-live run.
- The `/api/runs` submission path can persist a user message before a
  concurrent enqueue failure, leaving an orphan message.

## High

- Jobs have no durable priority field or priority-aware scheduler.
- Isolated worker child spawn errors can leave jobs permanently marked
  `running`.
- Worker systemd configuration has no cgroup memory, CPU, or task limits.
- Provider connection selection uses newest update time instead of OAuth >
  account > API key precedence.
- OAuth reconnect clears the existing credential before the new flow succeeds.
- Provider connection tests accept incomplete OAuth/account credentials.
- Browser upload accepts arbitrary existing absolute server paths.
- Browser action queues and DNS/browser startup have no bounded timeout.
- Browser realtime preference is ignored by the frontend WebSocket URL.
- Terminal MCP question completion can attempt an invalid `completed ->
  interrupted` chat transition.
- Completed stream refreshes blank the chat during reload.
- Chat/model loading failures can leave the UI permanently empty or stuck.
- Cached chat revalidation can preserve stale queued-message state.

## Medium

- Direct submissions return `409` during an active run instead of entering
  the durable per-chat FIFO queue.
- Timeout and crash retry behavior is not covered by focused tests.
- Child process descendants are not reliably cleaned up on timeout.
- OAuth flow state transitions are not enforced and there is no cancellation
  route.
- OAuth/account/local connection paths are incomplete in quick setup.
- Browser idle cleanup is owner-wide instead of session-specific.
- Browser back/forward errors are suppressed.
- MCP timeout rejection does not cancel the underlying child operation.
- MCP schemas are published but not centrally validated.
- Todo status and long task text are not fully represented in the UI.

## Low

- Hook dependency warnings remain in large chat state effects.
- Browser and MCP end-to-end coverage is limited compared with the supported
  feature surface.

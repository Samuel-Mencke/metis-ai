# Mission: Comprehensive Error & UX Logging + Self-Healing Agent Tooling for Metis AI

Repo: /home/samuel/metis-ai (Next.js 15 + tsx custom server, SQLite, branch stable/overall)
Production services: metis-ai.service (server.mjs :4000) + metis-ai-worker.service (worker.ts). Deploy is done by the orchestrator — you do NOT build/restart services. Run `npx tsc --noEmit` and targeted `npx tsx --test tests/<file>.test.ts` to verify.

## Context (user complaint)
Samuel reports UI bugs he can't precisely reproduce: "absenden fühlt sich weird an, da springen texte, manchmal kann ich nix absenden" (send feels weird, text jumps, sometimes can't submit). There is NO visibility into client-side errors or UX anomalies. Goal: EVERY error — frontend, backend, worker, WebSocket/SSE, send-path anomalies — gets logged centrally, and the Metis agent itself gets tools to read these logs and FIX issues autonomously.

## Requirements

### 1. Central error log store (SQLite)
- New table `error_logs` in lib/sqlite.ts (follow the lazy-ALTER / ensure-table pattern already used, e.g. ensureSSHTargetsTable): columns id, ts (unix ms), level (error|warn|info), source (frontend|api|worker|ws|telegram|browser|system), chatId?, userId?, sessionLabel?, message, stack?, context (JSON: userAgent, url, route, component, extra payload). Index on ts and source.
- New module `lib/error-logs.ts` with: `logError(entry)`, `logFrontendError`, `queryErrorLogs({since?, source?, level?, chatId?, limit?})`, `pruneErrorLogs(keepDays=14)`. All writes fire-and-forget safe (never throw into the caller).
- Follow references/metis-persistence-pattern.md recipe (lazy import to avoid circular deps).

### 2. Ingestion API
- `POST /api/error-logs` (app/api/error-logs/route.ts): accepts batched client entries, auth-cookie-gated (same session check as other routes), rate-limit generously (e.g. 60/min), validates shape, inserts. Response never echoes stack details for foreign sessions.
- `GET /api/error-logs?since=&source=&level=&limit=` — owner-scoped, newest first.
- Server-side wrapper: a small `captureApiError(route, err, req)` helper used in existing API routes' catch blocks — start with the highest-value routes: /api/chat (send path!), /api/jobs, /api/chats. Don't refactor every route now.

### 3. Frontend instrumentation (components/app-shell.tsx + global)
- Global handlers in the app entry: `window.onerror`, `unhandledrejection`, React error boundary already exists — hook its catch to POST to /api/error-logs (batched, sendBeacon on unload fallback).
- console.error interceptor (lightweight, capped, deduped by message within 60s) in development-critical components.
- **Send-path UX telemetry** (the actual complaint — instrument, don't guess):
  - In `send()`/`sendInner()` and the queue-drain useEffect in app-shell.tsx (read references/message-queue-bugs.md FIRST — do not break the activeSendRef lock, fingerprint dedupe, or onAccepted contract):
    - log when a send is rejected/deduped/dropped and WHY (lock held, fingerprint match, empty text, validation fail)
    - log queue-drain retries, onAccepted timing, double-attempt detection
  - **Text-jumping detection**: log when the composer's value is reset/overwritten while non-empty (e.g. state races between streaming updates and composer state), and when messages array re-renders cause scroll anchoring loss if measurable cheaply (focus/selection loss in the textarea during active job = log once per job).
  - Keep instrumentation overhead negligible; all sends go through one `reportUxEvent(kind, detail)` helper in a new `lib/client-telemetry.ts`.
- IMPORTANT UI constraints: NO new buttons/icons/UI in the chat input bar or anywhere user-facing. Logging is invisible. Do not change visual behavior.

### 4. Worker + backend logging
- worker.ts / lib/worker-runner.ts / lib/providers/runner.ts: every job failure path already stores error in jobs.data — additionally write to error_logs via lib/error-logs.ts (source 'worker'). Cover ALL provider paths (runAiSdk, runCodex, runClaude, runAntigravity) — dual-path lesson from the skill.
- server.mjs: wrap WebSocket upgrade errors, SSE route errors (source 'ws').

### 5. Agent self-healing tools (gateway-core.mjs — lib/mcp-core/gateway-core.mjs)
Add core built-in tools (no child server needed), following existing tool def pattern:
- `list_recent_errors` (args: hours?, source?, level?, limit?) → formatted recent error log entries.
- `read_error_log_detail` (args: id) → full entry incl. stack + context JSON.
- `clear_error_logs` (args: older_than_hours?) → prune; gated behind the same permission policy as destructive ops if one exists for core tools.
System-prompt guidance: add ONE short line to providerPrompt() in lib/providers/runner.ts AND the Cursor-path prompt in worker-runner.ts (mirror in both, keep <40 tokens): when the user reports a UI/UX bug or something feels broken, consult list_recent_errors first, diagnose, fix in repo.

### 6. Tests
- tests/error-logs.test.ts: insert/query/prune, malformed entries rejected, fire-and-forget safety.
- Extend tests/composer-send.test.ts to cover the telemetry hooks (dedupe/lock reasons reported).
- `npx tsc --noEmit` must pass (note: tests/tool-search.test.ts has 4 PRE-EXISTING errors — do not fix unrelated files, but your changes must add zero new errors).

### 7. Verification (do these yourself)
- `npx tsc --noEmit` → no NEW errors.
- `npx tsx --test tests/error-logs.test.ts tests/composer-send.test.ts` → pass.
- Smoke: `npx tsx -e` script (wrap in async main, repo-root, no top-level await, no @/ aliases) that calls logError + queryErrorLogs against the real data/chat.sqlite and prints results.
- git add -A && git commit with a descriptive message. Do NOT touch systemd, do NOT run next build, do NOT restart services (orchestrator handles deploy).

## Pitfalls (from project skill — hard rules)
- No random frontend buttons/icons. Zero visible UI changes.
- Don't break send(): activeSendRef lock, fingerprint dedupe, onAccepted in every path, queue removal before send().
- Dual module instances: singletons shared between server.mjs and Next routes must be globalThis-anchored if needed.
- System prompt changes mirrored in BOTH paths, tiny token budget.
- Don't bulk-inject anything into prompts per-turn.
- `createMemory()` not `addMemory()`. Never pkill Metis processes. Never next build against live services.

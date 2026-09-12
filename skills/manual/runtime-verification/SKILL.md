---
name: runtime-verification
description: Verify nontrivial Metis changes through their real runtime surface instead of treating tests, lint or typecheck as proof that the feature works.
---

# Runtime verification

Use this after a change that affects product behavior.

1. Identify the real surface: browser/UI, API/socket, CLI/TUI, public library boundary, agent behavior, or workflow.
2. Start the actual application/service or use the already-running safe development instance.
3. Drive the smallest path that executes the changed behavior through that surface. Do not replace this with an internal import-and-call test.
4. Capture the observable result: response body, browser state/screenshot, terminal output, or agent/run events.
5. Probe at least one adjacent edge or failure case suggested by the change: cancellation, stale state, duplicate action, malformed input, reconnect, second session, refresh, or another realistic boundary.
6. Return PASS only when the runtime observation supports the claim. FAIL when observed behavior is wrong or ambiguous. BLOCKED when the surface cannot be reached, with the exact blocker. SKIP only when the change genuinely has no runtime surface.

Tests, lint, typecheck and builds remain useful regression checks. They are not runtime verification and must not be reported as such.

For browser/UI changes, use Metis' persistent browser session rather than spawning an unrelated browser. Preserve existing tabs/login state, avoid unnecessary reloads, and collect a fresh DOM/snapshot after actions when structural state matters; use screenshots when visual truth matters.

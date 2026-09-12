---
name: metis-browser-runtime
description: Use Metis' persistent browser safely and consistently for navigation, UI work and end-to-end verification without losing tabs or login state.
---

# Metis browser runtime

Use the Metis browser tools as the canonical browser surface. Do not spawn a separate Playwright/browser server when the built-in browser can perform the task.

- Reuse the existing browser session and active tab unless the task needs another tab. Treat tab IDs as durable references and switch explicitly.
- Inspect current visible/DOM state before choosing an action. After click, type, submit, scroll, navigation or tab changes, collect the cheapest fresh state that answers what changed.
- Prefer DOM/snapshot evidence for element/state truth and screenshots for visual/layout truth. Do not request both by default.
- Do not call goto on the current URL merely to refresh state. Preserve in-progress forms, logins and app state; reload only when the task requires it.
- Keep multiple tabs isolated. Closing or replacing a tab must never silently change another tab's identity.
- User and agent actions share one persistent profile, so authentication cookies and site state survive normal chat/run boundaries. Never clear profile/session data as a generic recovery step.
- Serialize actions within one browser session. Independent read-only inspection may be batched only when it cannot race navigation or mutation.
- If authentication, CAPTCHA or an external side effect blocks progress, preserve the browser state and surface the exact interaction needed instead of abandoning the run or switching to an unrelated browser.

For verification, exercise the same UI path a user would use. Internal API calls are supporting diagnostics, not a substitute for clicking the affected UI when the product surface is graphical.

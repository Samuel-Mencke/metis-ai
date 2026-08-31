# Persistent Control MCP

This control plane lets an MCP client hand work to Metis, disconnect, and later retrieve the durable result. It reuses Metis remote clients instead of creating a second SSH/agent stack.

## What it does

- `POST /api/control-mcp` exposes a bearer-authenticated MCP endpoint.
- `control_remote` provides direct shell/file/PTY access through an enrolled remote client whose policy is explicitly `full_access`.
- `control_start` creates a durable Antigravity run in SQLite.
- The Metis server loop executes Antigravity on the selected remote machine, captures the Antigravity `conversation_id`, and resumes it with `--conversation` on later iterations.
- `autoContinue: true` keeps iterating after the original MCP request/chat is gone.
- Runs and events survive browser/chat disconnects and Metis process restarts.
- Result files are listed by Antigravity in `.metis-control/<run-id>/artifacts.json`; the remote client uploads them through an authenticated internal HTTP endpoint. Images can later be returned as MCP image content.
- `control_inbox` is the durable handoff for results that completed while the caller was disconnected.

## Important semantic limitation

An external MCP server cannot force a message into a ChatGPT conversation after that conversation/client is closed. The durable equivalent is an inbox: Metis keeps running and stores the result; a later MCP connection calls `control_inbox`, `control_status`, and `control_read_artifact` to recover everything that happened while disconnected.

## Required environment

Set on the Metis server:

```bash
CONTROL_MCP_BEARER_TOKEN=<random-long-secret>
CONTROL_MCP_OWNER_ID=<metis-user-id>      # optional for single-user installs; first admin is fallback
METIS_CONTROL_AGY_PRINT_TIMEOUT=6h
```

Optional, only when the remote Antigravity installation is intentionally allowed to auto-approve all Antigravity tool permissions:

```bash
METIS_CONTROL_AGY_SKIP_PERMISSIONS=1
```

This does not replace the remote-client policy. Autonomous runs additionally require that the selected remote client is configured as `full_access` in Metis.

Generate a token without putting it in shell history, for example from a password manager or an interactive secret setup. Do not place the token in Git.

## Remote Antigravity machine

Install/update the Metis remote client from `/install/remote-client.mjs`. Version 1.2 adds:

- command timeouts up to six hours,
- authenticated result-artifact upload,
- binary-file support for diagnostics,
- the existing shell/file/PTY surface.

The remote machine needs:

- Node.js 22+
- `agy` authenticated and available on PATH (or `METIS_CONTROL_AGY_COMMAND`)
- access to the target workspace
- the remote-client service running continuously

For autonomous control set that remote client's Metis policy to `full_access` deliberately. All requests continue to be written to the existing remote audit log.

## MCP URL

If Metis is already exposed at `https://metis.example.com`, no second process is required:

```text
https://metis.example.com/api/control-mcp
```

Authentication header:

```text
Authorization: Bearer <CONTROL_MCP_BEARER_TOKEN>
```

The endpoint is stateless Streamable-HTTP style JSON-RPC. Durable state belongs to the Metis control database, not to an individual HTTP/MCP session.

## Cloudflare Tunnel

Prefer exposing the existing Metis HTTPS origin and routing the MCP path to the same service. A dedicated hostname can also be used:

```yaml
ingress:
  - hostname: control.example.com
    path: /api/control-mcp
    service: http://127.0.0.1:3100
  - service: http_status:404
```

Keep the bearer token enabled even when Cloudflare Access is used. Cloudflare Access is an additional perimeter, not a replacement for application authentication.

Do not cache `/api/control-mcp` or `/api/internal/control-artifacts`.

## Primary tools

### `control_clients`
Lists enrolled remote machines and current policy/status.

### `control_start`
Example arguments:

```json
{
  "clientId": "...",
  "cwd": "C:/Users/User/Documents/project",
  "prompt": "Implement and visually verify the requested feature end-to-end.",
  "model": "agy-gemini-3.7-flash-high",
  "effort": "high",
  "autoContinue": true,
  "maxIterations": 0,
  "intervalSeconds": 15
}
```

`maxIterations: 0` means run until the agent emits the configured completion marker or the run is cancelled.

### `control_continue`
Queues a new instruction for an existing run. If the run already completed, it is reopened and resumes the stored Antigravity conversation.

### `control_inbox`
Returns unread run updates/completions. Use this first when reconnecting after time away.

### `control_status`
Returns run state, durable events, last result, conversation id, and artifact metadata.

### `control_artifacts` / `control_read_artifact`
Lists and retrieves captured output. Images are emitted as MCP image content.

### `control_remote`
Direct low-level access to the remote client. The selected client must be `full_access`.

## Artifact contract for Antigravity

The control prompt tells Antigravity to create:

```text
<workspace>/.metis-control/<run-id>/artifacts.json
```

Example:

```json
[
  {"path":"C:/work/playwright/home.png","name":"home.png","mimeType":"image/png"},
  {"path":"C:/work/report.md","name":"report.md","mimeType":"text/markdown"}
]
```

The remote client uploads each listed file directly to Metis with its own remote credential. The credential is never sent to Antigravity or stored in the artifact manifest.

## Recovery behavior

Browser/MCP disconnect: no effect on a running control loop.

Metis restart: persisted `running` runs are placed back into recovery after a delay and keep their Antigravity conversation id. Because a process could theoretically still be finishing on the remote machine during a Metis restart, production deployments should avoid restarting Metis during active turns unless necessary.

Remote-client disconnect: treated as transient; the run sleeps and retries after reconnect.

## Deployment verification

1. Build Metis.
2. Restart the Metis service.
3. Update/restart the Antigravity remote client.
4. Confirm the client reports online and `full_access`.
5. Probe MCP `initialize` and `tools/list` with the bearer token.
6. Run a one-iteration `control_start` that creates a text artifact.
7. Run an `autoContinue` job, disconnect the MCP client, reconnect later, and verify it appears in `control_inbox`.
8. Run a screenshot-producing job and verify `control_read_artifact` returns image content.
9. Restart the browser/chat while the run is active and verify the run continues.

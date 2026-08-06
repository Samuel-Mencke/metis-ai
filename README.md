# Metis AI

Metis AI is an all-in-one agent platform: conversations, durable runs,
streaming tool calls, workspaces, memories, remote files and terminals, and a
configurable MCP gateway in one application.

## One-click installation

The installer supports Linux, macOS, and Windows with a native Node.js
installation. It can run interactively with arrow-key menus or entirely from
arguments for AI agents and CI jobs.

Linux:

```sh
bash -c "$(curl -fsSL https://metis-ai.f1shy312.com/install/linux)"
```

macOS:

```sh
bash -c "$(curl -fsSL https://metis-ai.f1shy312.com/install/macos)"
```

Windows PowerShell:

```powershell
irm https://metis-ai.f1shy312.com/install/windows | iex
```

The source repository is private. During an interactive install, authenticate
with `gh` first or provide a read-only `GITHUB_TOKEN`. Argument-driven installs
must provide `GITHUB_TOKEN` or run on a host with authenticated `gh`.

### AI and CI installation

Non-interactive mode never opens a prompt and fails fast when a required value
is missing. Use `--yes` to allow an existing installation to be updated.

```sh
METIS_AI_INSTALL_DIR=/opt/metis-ai \
GITHUB_TOKEN="$GITHUB_TOKEN" \
bash -c "$(curl -fsSL https://metis-ai.f1shy312.com/install/linux)" \
  --non-interactive --yes \
  --install-dir /opt/metis-ai \
  --data-dir /var/lib/metis-ai \
  --agent-cwd /var/lib/metis-ai/workspace \
  --enable-service
```

PowerShell:

```powershell
$script = Join-Path $env:TEMP "metis-ai-install.ps1"
irm https://metis-ai.f1shy312.com/install/install.ps1 -OutFile $script
& $script -NonInteractive -Yes -InstallDir "$env:LOCALAPPDATA\MetisAI" `
  -DataDir "$env:LOCALAPPDATA\MetisAI\data" -SkipBuild
```

Supported installer arguments include:

| Purpose | Unix | PowerShell |
| --- | --- | --- |
| No prompts | `--non-interactive` | `-NonInteractive` |
| Confirm updates | `--yes` | `-Yes` |
| Preview | `--dry-run --json` | `-DryRun -Json` |
| Source | `--source github|URL|DIR` | `-Source github|URL|DIR` |
| App directory | `--install-dir PATH` | `-InstallDir PATH` |
| Data directory | `--data-dir PATH` | `-DataDir PATH` |
| Agent workspace | `--agent-cwd PATH` | `-AgentCwd PATH` |
| Web/MCP ports | `--port N --mcp-port N` | `-Port N -McpPort N` |
| Secrets | `--chat-password`, `--mcp-token` | `-ChatPassword`, `-McpToken` |
| Worker service | `--enable-service` | `-EnableService` |
| Skip production build | `--skip-build` | `-SkipBuild` |

Secrets should be passed through environment variables or a secret manager
instead of command-line arguments because process lists can expose arguments.
Use `--dry-run --json` before an automated install to validate paths, ports,
and options without changing files.

The installer creates `.env` with restrictive permissions, defaults the web
and MCP listeners to loopback, installs dependencies using `pnpm` when a
`pnpm-lock.yaml` is present (otherwise npm), and can optionally install the
durable worker as a systemd service or Windows scheduled task.

For the reverse proxy and public installer URLs, use the Nginx configuration
and manual deployment steps in
[`deploy/nginx/README.md`](./deploy/nginx/README.md).

## Development

```bash
pnpm install
pnpm dev
```

The application reads local configuration from `.env`. Start with
`.env.example`, replace the secrets and deployment paths, and never commit
`.env`.

## Configuration

`APP_NAME`, `APP_DESCRIPTION`, `CHAT_USERNAME`, `AGENT_CWD`, `AI_CHAT_ROOT`,
`CHAT_DATA_DIR`, `AI_CHAT_MCP_STATE_DIR`, `AI_CHAT_INTERNAL_URL`, `PORT`, and
the MCP feature flags are centralized in `lib/config.ts`. Unset paths fall back
to the current working directory, the current user's home directory, or local
loopback bindings; no machine-specific path is required.

## MCP gateway

The gateway module boundary lives at
[`packages/mcp-gateway`](./packages/mcp-gateway/README.md). It connects the
agent runtime to registered MCP servers and supports discovery, workflows,
web/documentation tools, and platform integrations.

For a public deployment:

- set a strong `MCP_BEARER_TOKEN`;
- keep the gateway on localhost or behind a trusted authenticated proxy;
- configure `AI_CHAT_ROOT`, `AI_CHAT_MCP_STATE_DIR`, and `AGENT_CWD`;
- review dangerous tools such as shell, filesystem, Docker, and systemd;
- keep `.env`, `data/`, generated builds, logs, and credentials out of Git.

## Validation

```bash
pnpm exec tsc --noEmit
pnpm run lint
pnpm run build
```

## License

This repository is distributed under the MIT License. See `LICENSE`.

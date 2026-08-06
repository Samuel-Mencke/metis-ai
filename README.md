# Metis AI

Metis AI is an all-in-one agent platform: conversations, durable runs,
streaming tool calls, workspaces, memories, remote files and terminals, and a
configurable MCP gateway in one application.

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

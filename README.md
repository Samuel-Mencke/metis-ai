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

## AI provider connections

Provider connections are configured from Settings → Providers. API keys and
supported account credential bundles are encrypted at rest and are never sent
back to the browser. Set `AI_CHAT_SECRETS_KEY` before saving a connection; it
must be exactly 32 bytes, represented as 64 hexadecimal characters or base64:

```bash
openssl rand -hex 32
```

The application supports Cursor, OpenAI, Anthropic, Google Gemini, xAI/Grok,
OpenRouter, Ollama/local endpoints, Codex, Claude Code, Antigravity's supported
SDK credentials, and generic OpenAI-compatible providers. The generic
connection covers providers such as Groq, DeepSeek, Mistral, Together, vLLM,
LM Studio, and LiteLLM.

Codex also supports a link/device OAuth flow through the OAuth provider adapter;
the resulting credential file is encrypted per user. Existing official Codex
`auth.json` credentials remain supported. Claude Code OAuth remains experimental
and may conflict with Anthropic's current third-party usage restrictions.
Antigravity OAuth uses the official `agy` CLI remote-login flow; the CLI stores
its token profile in an isolated per-connection home directory.

The optional API-key/Vertex Antigravity agent path requires the Python package
in the Python environment selected by `ANTIGRAVITY_PYTHON`:

```bash
python3 -m pip install google-antigravity
```

Google Vertex/ADC connections also require a configured GCP project and
Application Default Credentials.

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
pnpm run test:providers
pnpm run lint
pnpm run build
```

## License

This repository is distributed under the MIT License. See `LICENSE`.

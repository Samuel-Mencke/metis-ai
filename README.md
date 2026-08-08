<div align="center">

<table>
  <tr>
    <td align="left" width="25%">
      <img src="./public/hand-left.png" alt="Left hand" width="180">
    </td>
    <td align="center" width="50%">
      <h1>Metis AI</h1>
    </td>
    <td align="right" width="25%">
      <img src="./public/hand-right.png" alt="Right hand" width="180">
    </td>
  </tr>
</table>
      <h3>A private, extensible workspace for AI agents</h3>

Conversations, tools, terminals, browser sessions, memories, workspaces and
MCP servers — brought together in one self-hosted application.

<p>
  <a href="https://github.com/f1shyondrugs/metis-ai">Repository</a>
  ·
  <a href="https://github.com/f1shyondrugs/metis-ai/issues">Issues</a>
  ·
  <a href="./CONTRIBUTING.md">Contributing</a>
</p>

</div>

> Metis AI is designed for people who want an agent workspace they can run,
> configure and extend themselves — without tying the entire experience to a
> single model provider.

## Why Metis AI?

Most AI interfaces stop at a chat transcript. Metis AI treats a conversation
as a durable workspace: an agent can use tools, work with files and terminals,
retain useful memories, operate a browser, and connect to external capabilities
through MCP.

### What is included

| Area | Capabilities |
| --- | --- |
| **Agent conversations** | Streaming responses, tool calls, thinking blocks, run cancellation and durable chat history |
| **Workspaces** | Plans, canvases, remote files and terminals available alongside a conversation |
| **Browser control** | Authenticated browser sessions with tabs, actions, viewport control and live streaming |
| **Memory** | User-managed durable memories that can be reviewed, edited or removed |
| **Provider freedom** | Multiple official providers, OAuth flows, local models and OpenAI-compatible endpoints |
| **MCP gateway** | Discover, register and call MCP servers, with workflows and optional platform integrations |
| **Sharing** | Share chats through links, optionally protected with a password, and revoke them later |

## Quick start

### Prerequisites

- Node.js 20+
- pnpm 9+
- A supported AI provider credential, unless you only want to explore the UI

### 1. Install

```bash
git clone https://github.com/f1shyondrugs/metis-ai.git
cd metis-ai
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set at least a login username/password. For provider
credentials, configure connections later from **Settings → Providers**.
Never commit `.env`.

### 3. Run the development server

```bash
pnpm dev
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100) and sign in with the
credentials from `.env`.

<details>
<summary><strong>Production-style start</strong></summary>

```bash
pnpm build
pnpm start
```

The custom server listens on `0.0.0.0` and defaults to port `3100`. Put it
behind an authenticated reverse proxy before exposing it to the internet.
</details>

## Provider connections

Provider connections are managed from **Settings → Providers**. Supported
connection types include:

- Cursor
- OpenAI, Anthropic, Google Gemini and xAI/Grok
- OpenRouter
- Ollama and other local endpoints
- Codex, Claude Code and supported Antigravity credentials
- Generic OpenAI-compatible APIs such as Groq, DeepSeek, Mistral, Together,
  vLLM, LM Studio and LiteLLM

API keys and supported account credential bundles are encrypted at rest and are
not returned to the browser. Set `AI_CHAT_SECRETS_KEY` before saving a
connection:

```bash
openssl rand -hex 32
```

The key must represent exactly 32 bytes: 64 hexadecimal characters or a
32-byte base64 value. Google Vertex/ADC connections additionally need a GCP
project and configured Application Default Credentials. The optional
Antigravity Python path needs:

```bash
python3 -m pip install google-antigravity
```

## MCP gateway

The gateway lives behind the public module boundary in
[`packages/mcp-gateway`](./packages/mcp-gateway/README.md). It connects the
agent runtime to registered local or remote MCP servers and supports discovery,
workflows, web/documentation tools and selected platform integrations.

For a trusted deployment:

1. Set a long, random `MCP_BEARER_TOKEN`.
2. Keep the gateway on localhost or place it behind a trusted authenticated
   proxy.
3. Set `AI_CHAT_ROOT`, `AI_CHAT_MCP_STATE_DIR` and `AGENT_CWD` explicitly.
4. Enable remote, optional or dangerous integrations only when you understand
   their permissions.
5. Treat shell, filesystem, Docker and service-control tools as privileged.

See [`SECURITY.md`](./SECURITY.md) and the gateway
[`README.md`](./packages/mcp-gateway/README.md) before exposing any endpoint.

## Configuration reference

The complete example is in [`.env.example`](./.env.example). The most useful
settings are:

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Web application port | `3100` |
| `CHAT_USERNAME` / `CHAT_PASSWORD` | Application login | `admin` / required |
| `CHAT_DATA_DIR` | SQLite database and runtime data directory | `./data` |
| `AGENT_CWD` | Default working directory for agent tools | User home |
| `AI_CHAT_SECRETS_KEY` | Encryption key for provider credentials | Unset |
| `MCP_PORT` | MCP gateway port | `8787` |
| `MCP_BEARER_TOKEN` | Gateway authentication token | Unset |
| `MCP_ALLOW_REMOTE_ADMIN` | Allow remote administrative operations | `false` |
| `MCP_ENABLE_REMOTE_SERVERS` | Enable remote MCP servers | `false` |
| `MCP_ENABLE_OPTIONAL_SERVERS` | Enable optional integrations | `false` |

## Development

```bash
pnpm dev                 # Start Next.js in development mode
pnpm typecheck           # TypeScript validation
pnpm run test:providers  # Provider adapter tests
pnpm test                # Provider and security tests
pnpm lint                # ESLint
pnpm build               # Production build
```

Before opening a pull request, run the checks that cover your change. The
project's contribution expectations are documented in
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Project layout

```text
app/                  Next.js routes, pages and API handlers
components/           React UI and workspace panels
lib/                  Agent runtime, providers, storage and MCP internals
packages/mcp-gateway/ Public MCP gateway module boundary
scripts/              Security and maintenance checks
tests/                Provider-focused tests
public/               Static assets and prompt data
```

## Security

Metis AI can execute powerful operations through agents and MCP servers. Do not
expose a default installation directly to the public internet. Use strong
secrets, a trusted proxy, least-privilege MCP configuration and isolated
working directories. See [`SECURITY.md`](./SECURITY.md) for the reporting
process and deployment guidance.

## License

Metis AI is released under the [MIT License](./LICENSE).

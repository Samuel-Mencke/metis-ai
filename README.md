<div align="center">

<table>
  <tr>
    <td align="left" width="25%">
      <img src="./public/hand-left.png" alt="Left hand" width="180">
    </td>
    <td align="center" width="50%">
      <img src="./public/metis.png" alt="Metis AI" width="640">
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

<p align="center">
  <img src="./public/why-metis.png" alt="Why Metis AI?" width="100%">
</p>

Most AI interfaces stop at a chat transcript. Metis AI treats a conversation
as a durable workspace. It combines the agent, its context, the tools it can
use and the artifacts it creates in one private, self-hosted environment.

### Feature overview

Metis AI includes the following capabilities:

| Area | Capabilities |
| --- | --- |
| **Agent runtime** | Streaming responses, tool calls, thinking blocks, follow-up questions, run cancellation, resume support and durable chat history |
| **Context and files** | Image and file uploads, previews, references, pinned context and model-aware context limits |
| **Workspaces** | Plans, canvases, notes, memories, remote files and terminals available alongside a conversation |
| **Browser control** | Authenticated browser sessions with tabs, navigation, forms, clicks, typing, scrolling, screenshots and viewport control |
| **Voice** | Speech transcription and realtime voice sessions when compatible credentials are configured |
| **Provider freedom** | OpenAI, Anthropic, Google, xAI, OpenRouter, Cursor, Codex, Claude Code, Ollama, Vertex/ADC and generic OpenAI-compatible endpoints |
| **MCP gateway** | Discover, register and call local or remote MCP servers, plus workflows, automations, web/documentation tools and platform integrations |
| **Remote execution** | Enrolled remote clients with authenticated command execution, testing and file/workspace operations |
| **Sharing and recovery** | Share chats and attachments through links, optionally protect them with a password, clone shared chats and revoke access |
| **Administration** | Provider discovery and testing, model listing, preferences, status checks, recovery flows and configurable security boundaries |

<p align="center">
  <img src="./public/quick-start.png" alt="Quick start" width="100%">
</p>

### One-line installer

For a guided installation with runtime detection, first-user creation, encrypted
provider storage, native background services and an uninstall manifest, download
the installer directly from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install/linux.sh | bash
```

On macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install/macos.sh | bash
```

For agents and CI, Linux and macOS support a prompt-free argument mode. When
piping a script to Bash, use `bash -s --` so the arguments are passed to the
installer:

```bash
curl -fsSL https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install/linux.sh |
  bash -s -- --non-interactive --password 'replace-with-a-strong-password'

curl -fsSL https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install/macos.sh |
  bash -s -- --non-interactive --password 'replace-with-a-strong-password'
```

Use `--help` for all available options. Prefer `--password-file` or another
secret manager when the password should not appear in process listings.

On Windows, run:

```powershell
irm https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install/windows.ps1 | iex
```

For a prompt-free Windows installation, download the script and pass named
arguments:

```powershell
irm https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install/windows.ps1 -OutFile install.ps1
.\install.ps1 -NonInteractive -PasswordFile .\metis-password.txt
```

All three installers accept argument-only configuration for the install
directory, data directory, agent workspace, ports, bind address, username,
password, service name and public URL. Use `--help` on Linux/macOS or `-Help`
on Windows for the complete list.

#### Non-interactive options

The option names are intentionally listed side by side so the same deployment
configuration can be reproduced on every supported operating system. Linux and
macOS use Bash options; Windows uses PowerShell named parameters.

| Purpose | Linux | macOS | Windows | Default |
| --- | --- | --- | --- | --- |
| Application checkout | `--install-dir DIR` | `--install-dir DIR` | `-InstallDir DIR` | `~/metis-ai` |
| Runtime data directory | `--data-dir DIR` | `--data-dir DIR` | `-DataDir DIR` | `INSTALL_DIR/data` |
| Agent workspace | `--agent-cwd DIR` | `--agent-cwd DIR` | `-AgentCwd DIR` | user home |
| Web port | `--port PORT` | `--port PORT` | `-Port PORT` | `3100` |
| Bind address | `--host HOST` | `--host HOST` | `-Host HOST` | `127.0.0.1` |
| MCP gateway port | `--mcp-port PORT` | `--mcp-port PORT` | `-McpPort PORT` | `8787` |
| Initial login name | `--username NAME` | `--username NAME` | `-Username NAME` | `admin` |
| Initial login password | `--password PASSWORD` | `--password PASSWORD` | `-Password PASSWORD` | required in non-interactive mode |
| Password file | `--password-file FILE` | `--password-file FILE` | `-PasswordFile FILE` | unset |
| Service/task name | `--service-name NAME` | `--service-name NAME` | `-ServiceName NAME` | `metis-ai` / `MetisAI` |
| Public URL | `--public-url URL` | `--public-url URL` | `-PublicUrl URL` | `http://127.0.0.1:PORT` |
| No prompts | `--non-interactive` | `--non-interactive` | `-NonInteractive` | off |
| Skip runtime installation | — | — | `-SkipRuntimeInstall` | off |
| Show help | `--help` or `-h` | `--help` or `-h` | `-Help` | — |

For Linux and macOS, pass installer arguments after `bash -s --`. For
PowerShell, download the script first and invoke it with the named parameters.
`--password-file`/`-PasswordFile` is preferred in automation so a password does
not appear in the process list. `-SkipRuntimeInstall` only skips Windows'
automatic Git/Node.js installation; it still verifies that the required tools
are available.

The installer asks for all machine-specific values instead of assuming a user,
home directory, port or public hostname. Review downloaded scripts before
executing them in security-sensitive environments. The repository source can be
overridden with `METIS_AI_REPO_URL`.

The installers also ask whether the web application should be reachable on the
local network. The secure default binds to `127.0.0.1`; choosing the network
option binds to `0.0.0.0` and requires a strong password plus a firewall or
trusted TLS reverse proxy.

The scripts are hosted in the repository under `install/`; the website and
Nginx configuration are not required for installation. Every installer writes
an installation manifest and a matching uninstaller into
the selected installation directory. Use `--keep-data` (or `-KeepData` on
Windows) to remove services and application files while retaining chats,
memories, uploads and encrypted provider credentials. Use `--dry-run` before
removal when reviewing an existing installation.

<p align="center">
  <img src="./public/prerequisites.png" alt="Prerequisites" width="100%">
</p>

- Node.js 22+
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

The custom server listens on `AI_CHAT_HOST` (default `127.0.0.1`) and defaults
to port `3100`. Set `AI_CHAT_HOST=0.0.0.0` only when the app should be
reachable on the local network, and put it behind an authenticated TLS reverse
proxy before exposing it beyond a trusted LAN.
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

<p align="center">
  <img src="./public/mcp-gateway.png" alt="MCP gateway" width="100%">
</p>

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

<p align="center">
  <img src="./public/configuration.png" alt="Configuration" width="100%">
</p>

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

<p align="center">
  <img src="./public/development.png" alt="Development" width="100%">
</p>

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

<p align="center">
  <img src="./public/project-layout.png" alt="Project layout" width="100%">
</p>

```text
app/                  Next.js routes, pages and API handlers
components/           React UI and workspace panels
lib/                  Agent runtime, providers, storage and MCP internals
packages/mcp-gateway/ Public MCP gateway module boundary
scripts/              Security and maintenance checks
tests/                Provider-focused tests
public/               Static assets and prompt data
```

<p align="center">
  <img src="./public/security.png" alt="Security" width="100%">
</p>

Metis AI can execute powerful operations through agents and MCP servers. Do not
expose a default installation directly to the public internet. Use strong
secrets, a trusted proxy, least-privilege MCP configuration and isolated
working directories. See [`SECURITY.md`](./SECURITY.md) for the reporting
process and deployment guidance.

<p align="center">
  <img src="./public/license.png" alt="License" width="100%">
</p>

Metis AI is released under the [MIT License](./LICENSE).

# Metis AI MCP Gateway

This package is the public module boundary for the Metis AI agent platform's
MCP gateway. It exposes the gateway dispatcher and registry operations while
the application keeps the runtime implementation in `lib/mcp-core`.

## Configuration

The gateway uses environment variables instead of machine-specific paths:

```text
MCP_PORT=8787
MCP_PUBLIC_URL=http://127.0.0.1:8787
MCP_BEARER_TOKEN=replace-me
MCP_ALLOW_REMOTE_ADMIN=false
MCP_SDK_ROOT=/path/to/node_modules/@modelcontextprotocol/sdk
AI_CHAT_ROOT=/path/to/metis-ai
AI_CHAT_MCP_STATE_DIR=/path/to/state
AGENT_CWD=/path/to/agent-workspace
```

Never commit bearer tokens, chat passwords, `.env` files, databases, or
runtime state. Keep the gateway bound to localhost unless it is protected by
authentication and a trusted network boundary.

The gateway can discover and call registered child MCP servers, expose web and
documentation tools, run allowlisted platform operations, persist workflows,
and provision supported servers from the official MCP Registry. Dangerous
operations such as shell, Docker, filesystem, and service control should only
be enabled in a trusted, authenticated deployment.

import os from "node:os";
import path from "node:path";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function numberEnv(name: string, fallback: number) {
  const value = Number.parseInt(env(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function booleanEnv(name: string, fallback = false) {
  const value = env(name).toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

const root = env("AI_CHAT_ROOT") || process.cwd();
const dataDir = env("CHAT_DATA_DIR") || path.join(root, "data");
const port = numberEnv("PORT", 3100);

export const config = {
  appName: env("APP_NAME") || "Metis AI",
  appDescription: env("APP_DESCRIPTION") || "A private, configurable AI agent workspace.",
  chatUsername: env("CHAT_USERNAME") || "admin",
  agentCwd: env("AGENT_CWD") || env("HOME") || os.homedir() || process.cwd(),
  root,
  dataDir,
  databasePath: env("CHAT_DB_PATH") || path.join(dataDir, "chat.sqlite"),
  mcpStateDir: env("AI_CHAT_MCP_STATE_DIR") || path.join(dataDir, "mcp-state"),
  internalUrl:
    env("AI_CHAT_INTERNAL_URL") || `http://127.0.0.1:${port}/api/internal/mcp-question`,
  port,
  mcpPort: numberEnv("MCP_PORT", 8787),
  mcpPublicUrl: env("MCP_PUBLIC_URL") || `http://127.0.0.1:${numberEnv("MCP_PORT", 8787)}`,
  mcpAllowRemoteAdmin: booleanEnv("MCP_ALLOW_REMOTE_ADMIN"),
  enableOptionalMcp: booleanEnv("MCP_ENABLE_OPTIONAL_SERVERS"),
  enableRemoteMcp: booleanEnv("MCP_ENABLE_REMOTE_SERVERS"),
} as const;

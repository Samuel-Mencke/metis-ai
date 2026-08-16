import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { getUserAccess, getUserExecutionIdentity } from "@/lib/user-access";
export { getUserExecutionIdentity } from "@/lib/user-access";

export type McpServerMap = Record<
  string,
  {
    type: "stdio";
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
  }
>;

export type McpContext = {
  chatId?: string;
  userId?: string;
  jobId?: string;
  incognito?: boolean;
  automation?: boolean;
  modeId?: string;
  modePolicy?: string;
  compressionEnabled?: boolean;
  compressionMode?: string;
  compressionToolResults?: boolean;
};

export function getMcpServers(context: McpContext = {}): McpServerMap {
  const appRoot = config.root;
  const agentCwd = getUserAgentCwd(context.userId);
  const identity = getUserExecutionIdentity(context.userId);
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      MCP_CHAT_ID: context.chatId,
      MCP_USER_ID: context.userId,
      MCP_JOB_ID: context.jobId,
      MCP_INCOGNITO: context.incognito ? "1" : undefined,
      MCP_AUTOMATION: context.automation ? "1" : undefined,
      MCP_MODE_ID: context.modeId,
      MCP_MODE_POLICY: context.modePolicy,
      MCP_COMPRESSION_ENABLED: context.compressionEnabled ? "1" : undefined,
      MCP_COMPRESSION_MODE: context.compressionMode,
      MCP_COMPRESSION_TOOL_RESULTS: context.compressionToolResults === false ? "0" : "1",
      MCP_AGENT_CWD: agentCwd,
      MCP_OS_USERNAME: identity?.username,
      MCP_OS_UID: identity ? String(identity.uid) : undefined,
      MCP_OS_GID: identity ? String(identity.gid) : undefined,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return {
    gateway: {
      type: "stdio",
      command: process.execPath,
      args: [
        path.join(appRoot, "lib", "run-user-mcp.mjs"),
        process.env.AI_CHAT_INTERNAL_MCP_SERVER?.trim() ||
          path.join(appRoot, "lib", "internal-mcp-server.mjs"),
      ],
      cwd: appRoot,
      env,
    },
  };
}

export function getAgentCwd(userId?: string): string {
  return userId ? getUserAgentCwd(userId) : config.agentCwd;
}

export function getUserAgentCwd(userId?: string): string {
  const workspace = getUserAccess(userId).workspaceRoot;
  fs.mkdirSync(workspace, { recursive: true });
  return workspace;
}

export async function checkGatewayHealth(): Promise<{
  ok: boolean;
  url: string;
  detail: string;
}> {
  return {
    ok: true,
    url: "stdio://ai-chat-internal-mcp",
    detail: "internal MCP configured",
  };
}

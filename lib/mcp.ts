import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

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
};

export function getMcpServers(context: McpContext = {}): McpServerMap {
  const appRoot = config.root;
  const agentCwd = getUserAgentCwd(context.userId);
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      MCP_CHAT_ID: context.chatId,
      MCP_USER_ID: context.userId,
      MCP_JOB_ID: context.jobId,
      MCP_INCOGNITO: context.incognito ? "1" : undefined,
      MCP_AGENT_CWD: agentCwd,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return {
    gateway: {
      type: "stdio",
      command: process.execPath,
      args: [
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
  if (!userId?.trim()) return config.agentCwd;
  const normalized = userId.trim();
  const slug = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48) || "user";
  const suffix = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 12);
  const workspace = path.join(config.root, "workspaces", `${slug}-${suffix}`);
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

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
};

export function getMcpServers(context: McpContext = {}): McpServerMap {
  const appRoot = config.root;
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      MCP_CHAT_ID: context.chatId,
      MCP_USER_ID: context.userId,
      MCP_JOB_ID: context.jobId,
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

export function getAgentCwd(): string {
  return config.agentCwd;
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

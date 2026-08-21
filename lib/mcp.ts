import fs from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import { getUserAccess, getUserExecutionIdentity, isHostAdmin, requireUserExecutionIdentity } from "@/lib/user-access";
export { getUserExecutionIdentity } from "@/lib/user-access";

export type McpServerMap = Record<
  string,
  | {
      type: "stdio";
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    }
  | {
      type: "http";
      url: string;
      headers?: Record<string, string>;
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

export function buildMcpContext(input: {
  chatId?: string;
  userId?: string;
  jobId?: string;
  incognito?: boolean;
  automation?: boolean;
  modeId?: string;
  modePolicy?: string | { allowedCategories: unknown; toolOverrides?: unknown };
  compressionEnabled?: boolean;
  compressionMode?: string;
  compressionToolResults?: boolean;
}): McpContext {
  const modePolicy = typeof input.modePolicy === "string"
    ? input.modePolicy
    : input.modePolicy
      ? JSON.stringify({
          allowedCategories: input.modePolicy.allowedCategories,
          toolOverrides: input.modePolicy.toolOverrides || {},
        })
      : undefined;
  return {
    chatId: input.chatId,
    userId: input.userId,
    jobId: input.jobId,
    incognito: input.incognito,
    automation: input.automation,
    modeId: input.modeId,
    modePolicy,
    compressionEnabled: input.compressionEnabled,
    compressionMode: input.compressionMode,
    compressionToolResults: input.compressionToolResults,
  };
}

export function getMcpServers(context: McpContext = {}): McpServerMap {
  const appRoot = config.root;
  if (!context.userId?.trim()) {
    throw new Error("Agent tools require an authenticated account with an OS user mapping.");
  }
  const identity = requireUserExecutionIdentity(context.userId);
  const agentCwd = getUserAgentCwd(context.userId);
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      HOME: identity.home || process.env.HOME,
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
      AI_CHAT_INTERNAL_ORIGIN: config.internalOrigin,
      AI_CHAT_PUBLIC_URL: config.publicUrl,
      AI_CHAT_INTERNAL_URL: config.internalUrl,
      AI_CHAT_WORKSPACE_URL: config.workspaceUrl,
      AI_CHAT_CHAT_URL: config.chatUrl,
      AI_CHAT_NOTES_URL: config.notesUrl,
      AI_CHAT_MEMORY_URL: config.memoryUrl,
      AI_CHAT_BROWSER_URL: config.browserUrl,
      AI_CHAT_AGENT_STATE_URL: config.agentStateUrl,
      AI_CHAT_SUBAGENT_URL: config.subagentUrl,
      AI_CHAT_AUTOMATION_URL: config.automationUrl,
      AI_CHAT_FILE_URL: config.fileUrl,
      MCP_OS_USERNAME: identity?.username,
      MCP_OS_UID: identity ? String(identity.uid) : undefined,
      MCP_OS_GID: identity ? String(identity.gid) : undefined,
      MCP_ALLOW_ROOT_AGENTS: config.allowRootAgents ? "1" : "0",
      MCP_IS_HOST_ADMIN: isHostAdmin(context.userId) ? "1" : "0",
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
    ...(config.mcpPublicUrl
      ? {
          "ai-chat-universal": {
            type: "http" as const,
            url: `${config.mcpPublicUrl.replace(/\/$/, "")}/all`,
            headers: {
              Authorization: `Bearer ${process.env.MCP_BEARER_TOKEN || ""}`,
              "X-AI-Chat-User-Id": context.userId || "",
              "X-AI-Chat-Id": context.chatId || "",
              "X-AI-Chat-Job-Id": context.jobId || "",
              "X-AI-Chat-Incognito": context.incognito ? "1" : "0",
            },
          },
        }
      : {}),
  };
}

export function getAgentCwd(userId?: string): string {
  return userId ? getUserAgentCwd(userId) : config.agentCwd;
}

export function getUserAgentCwd(userId?: string): string {
  const workspace = getUserAccess(userId).workspaceRoot;
  fs.mkdirSync(workspace, { recursive: true });
  const identity = getUserExecutionIdentity(userId);
  if (identity) {
    try {
      fs.chownSync(workspace, identity.uid, identity.gid);
    } catch {
      // The service may lack permission to chown an already-owned home directory.
    }
  }
  return workspace;
}

export async function checkGatewayHealth(): Promise<{
  ok: boolean;
  url: string;
  detail: string;
  checks?: Record<string, { ok: boolean; url: string; detail: string }>;
}> {
  const checks = Object.fromEntries(
    await Promise.all(
      [
        ["gateway", `${config.mcpPublicUrl.replace(/\/+$/, "")}/health`],
        ["workspace", config.workspaceUrl],
        ["chat", config.chatUrl],
        ["subagent", config.subagentUrl],
        ["agentState", config.agentStateUrl],
      ].map(async ([name, url]) => {
        try {
          const response = await fetch(url, {
            headers: config.mcpBearerToken
              ? { Authorization: `Bearer ${config.mcpBearerToken}` }
              : undefined,
            signal: AbortSignal.timeout(2_000),
          });
          const contentType = response.headers.get("content-type") || "";
          const body = await response.text();
          const validBody = !/^text\/html\b/i.test(contentType) && !/^\s*<!doctype html/i.test(body);
          // Gateway /health returns JSON { ok, name } — surface an explicit ok:false.
          let bodyOk = true;
          let gatewayName = "";
          if (name === "gateway") {
            try {
              const parsed = JSON.parse(body) as { ok?: boolean; name?: string };
              bodyOk = parsed.ok !== false;
              gatewayName = parsed.name || "";
            } catch {
              bodyOk = false;
            }
          }
          const ok = response.ok && validBody && bodyOk;
          return [name, {
            ok,
            url,
            detail: ok
              ? gatewayName ? `HTTP ${response.status} · ${gatewayName}` : `HTTP ${response.status}`
              : `HTTP ${response.status}${validBody ? "" : "; HTML response received"}`,
          }] as const;
        } catch (error) {
          return [name, {
            ok: false,
            url,
            detail: error instanceof Error ? error.message : "health check failed",
          }] as const;
        }
      }),
    ),
  );
  const ok = Object.values(checks).every((check) => check.ok);
  return {
    ok,
    url: "stdio://ai-chat-internal-mcp",
    detail: ok ? "internal MCP and runtime routes are healthy" : "one or more MCP/runtime routes are unhealthy",
    checks,
  };}

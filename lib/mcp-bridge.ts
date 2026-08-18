import { spawn } from "node:child_process";
import path from "node:path";
import { tool, jsonSchema, type ToolSet } from "ai";
import { config } from "@/lib/config";

/**
 * Bridges the internal Metis MCP gateway (77+ tools: shell, files, browser,
 * plans, notes, memory, context hub, ...) into AI-SDK `tools` so plain
 * OpenAI-compatible providers (GLM/z.ai, OpenRouter, Ollama, ...) get the
 * same agent surface as the Cursor SDK path.
 *
 * Mode policy is applied by the gateway itself (MCP_MODE_POLICY env), so
 * disallowed tools are rejected server-side per chat mode.
 */

export type McpBridgeTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };

type GatewayProcess = {
  proc: ReturnType<typeof spawn>;
  requestId: number;
  initialized: boolean;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
};

const startedProcesses = new Map<string, GatewayProcess>();

function startGateway(env: Record<string, string>): GatewayProcess {
  const key = JSON.stringify(env);
  const existing = startedProcesses.get(key);
  if (existing && existing.proc.exitCode === null) return existing;

  const serverPath = process.env.AI_CHAT_INTERNAL_MCP_SERVER?.trim()
    || path.join(config.root, "lib", "internal-mcp-server.mjs");
  const proc = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const gateway: GatewayProcess = { proc, requestId: 0, initialized: false, pending: new Map() };
  let buffer = "";
  proc.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      try {
        const message = JSON.parse(line);
        const pending = gateway.pending.get(message.id);
        if (pending) {
          gateway.pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(message.error.message || "MCP error"));
          else pending.resolve(message.result);
        }
      } catch {
        // Non-JSON log line from the server process; ignore.
      }
    }
  });
  proc.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) console.error(`[mcp-bridge] ${text.slice(0, 300)}`);
  });
  proc.on("exit", () => {
    for (const [, pending] of gateway.pending) {
      pending.reject(new Error("MCP gateway process exited"));
      clearTimeout(pending.timer);
    }
    gateway.pending.clear();
    gateway.initialized = false;
    if (startedProcesses.get(key) === gateway) startedProcesses.delete(key);
  });
  startedProcesses.set(key, gateway);
  return gateway;
}

function callGateway(gateway: GatewayProcess, method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
  const id = ++gateway.requestId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      gateway.pending.delete(id);
      reject(new Error(`MCP ${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    gateway.pending.set(id, { resolve, reject, timer });
    gateway.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

async function withFreshGateway<T>(env: Record<string, string>, fn: (gateway: GatewayProcess) => Promise<T>): Promise<T> {
  const gateway = startGateway(env);
  // Initialize exactly once per gateway process — the process is reused across
  // tool calls, so re-running the handshake per call is pure spawn tax.
  if (!gateway.initialized) {
    await callGateway(gateway, "initialize", INIT_PARAMS, 20_000);
    gateway.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    gateway.initialized = true;
  }
  try {
    return await fn(gateway);
  } catch (error) {
    // Restart once on a dead process so long-lived worker jobs recover.
    if (gateway.proc.exitCode !== null) {
      const fresh = startGateway(env);
      if (!fresh.initialized) {
        await callGateway(fresh, "initialize", INIT_PARAMS, 20_000);
        fresh.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        fresh.initialized = true;
      }
      return await fn(fresh);
    }
    throw error;
  }
}

const INIT_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "metis-ai-sdk-bridge", version: "1.0.0" },
};

/** Filter to a safe, generally useful subset for non-SDK providers. */
const DEFAULT_EXCLUDE = new Set([
  "provide_file", // needs chat upload context wiring
  "ask_user", "request_mode_change", "wait", "subagent_status", // interactive flows handled by SDK paths
]);

export async function mcpBridgeTools(
  env: Record<string, string>,
  options: { include?: string[]; exclude?: string[] } = {},
): Promise<ToolSet> {
  const definitions = await withFreshGateway(env, async (gateway) => {
    const result = await callGateway(gateway, "tools/list", {}, 20_000) as { tools?: McpBridgeTool[] };
    return result?.tools || [];
  });

  const exclude = new Set([...DEFAULT_EXCLUDE, ...(options.exclude || [])]);
  const include = options.include ? new Set(options.include) : null;
  const tools: ToolSet = {};
  for (const definition of definitions) {
    if (!definition.name || exclude.has(definition.name)) continue;
    if (include && !include.has(definition.name)) continue;
    const bridgedExecute = async (args: Record<string, unknown>) => {
      const result = await withFreshGateway(env, async (gateway) => {
        return callGateway(gateway, "tools/call", { name: definition.name, arguments: args || {} }, 300_000);
      });
      const record = result as { content?: Array<{ type?: string; text?: string }> };
      const text = (record?.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text || "")
        .join("\n");
      const recordWithError = result as { isError?: boolean };
      if (recordWithError?.isError) throw new Error(text || `Tool ${definition.name} failed`);
      return text || result || "";
    };
    tools[definition.name] = tool({
      description: (definition.description || definition.name).slice(0, 2_000),
      parameters: jsonSchema(
        ((definition.inputSchema || { type: "object", properties: {} }) as unknown) as Parameters<typeof jsonSchema>[0],
      ),
      execute: bridgedExecute,
    } as never) as ToolSet[string];
  }
  return tools;
}

export function closeMcpBridges() {
  for (const [, gateway] of startedProcesses) gateway.proc.kill();
  startedProcesses.clear();
}

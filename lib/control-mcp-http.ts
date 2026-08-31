import { timingSafeEqual } from "node:crypto";
import { getDatabase } from "@/lib/sqlite";
import { listRemoteClients, getRemoteClient, type RemoteAction } from "@/lib/remote-clients";
import { requestRemoteClient } from "@/lib/remote-client-gateway";
import {
  acknowledgeControlRun,
  createControlRun,
  getControlRun,
  listControlArtifacts,
  listControlEvents,
  listControlInbox,
  listControlRuns,
  queueControlInstruction,
  readControlArtifact,
  requestControlCancel,
} from "@/lib/control-plane";
import { CallToolRequestSchema, ListToolsRequestSchema, Server } from "../packages/mcp-gateway/index.mjs";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function configuredToken() {
  return process.env.CONTROL_MCP_BEARER_TOKEN?.trim() || process.env.MCP_BEARER_TOKEN?.trim() || "";
}

function authorized(req: any) {
  const expected = configuredToken();
  if (!expected) return false;
  const header = String(req.headers?.authorization || "");
  const actual = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function ownerId() {
  const explicit = process.env.CONTROL_MCP_OWNER_ID?.trim();
  if (explicit) return explicit;
  const row = getDatabase().prepare("SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1").get() as { id?: string } | undefined;
  if (!row?.id) throw new Error("CONTROL_MCP_OWNER_ID is not configured and no admin user exists");
  return row.id;
}

function toolDefinitions() {
  return [
    { name: "control_clients", description: "List enrolled remote Metis clients and their live policy/status.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "control_start", description: "Start a durable Antigravity run on a remote client. With autoContinue it keeps running after the MCP caller disconnects, until the completion marker, iteration limit, or cancellation.", inputSchema: { type: "object", required: ["clientId", "cwd", "prompt"], properties: { clientId: { type: "string" }, cwd: { type: "string" }, prompt: { type: "string" }, model: { type: "string" }, effort: { type: "string", enum: ["low", "medium", "high"] }, autoContinue: { type: "boolean", default: false }, maxIterations: { type: "integer", minimum: 0, maximum: 10000, description: "0 means no iteration limit; run until completion marker or cancellation." }, intervalSeconds: { type: "integer", minimum: 1, maximum: 86400 }, loopPrompt: { type: "string" }, stopMarker: { type: "string" } }, additionalProperties: false } },
    { name: "control_continue", description: "Queue a follow-up instruction on an existing durable run/conversation. Completed runs are reopened and resume their Antigravity conversation.", inputSchema: { type: "object", required: ["runId", "prompt"], properties: { runId: { type: "string" }, prompt: { type: "string" } }, additionalProperties: false } },
    { name: "control_status", description: "Read durable run state, recent events and artifact metadata.", inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" }, eventLimit: { type: "integer", minimum: 1, maximum: 1000 } }, additionalProperties: false } },
    { name: "control_runs", description: "List recent durable control runs.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "control_cancel", description: "Request cancellation of a durable control run. Queued/sleeping runs stop immediately; an already executing remote turn stops after that turn returns.", inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } }, additionalProperties: false } },
    { name: "control_inbox", description: "List unread run completions/updates that happened while the MCP client was disconnected.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "control_ack", description: "Mark a durable run result as read in the control inbox.", inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } }, additionalProperties: false } },
    { name: "control_artifacts", description: "List text/image/file artifacts captured from a run.", inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } }, additionalProperties: false } },
    { name: "control_read_artifact", description: "Read a captured artifact. Images are returned as MCP image content; text is returned as text.", inputSchema: { type: "object", required: ["artifactId"], properties: { artifactId: { type: "string" } }, additionalProperties: false } },
    { name: "control_remote", description: "Directly execute a remote-client action. Requires that the selected client is explicitly configured with full_access policy.", inputSchema: { type: "object", required: ["clientId", "action"], properties: { clientId: { type: "string" }, action: { type: "string", enum: ["get_info", "list_directory", "read_file", "write_file", "edit_file", "delete_file", "execute_command", "pty_open", "pty_input", "pty_resize", "pty_close"] }, params: { type: "object", additionalProperties: true }, timeoutMs: { type: "integer", minimum: 1000, maximum: 21660000 } }, additionalProperties: false } },
  ];
}

function createServer(owner: string) {
  const server = new Server({ name: "metis-persistent-control", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions() }));
  server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    const name = request.params?.name;
    const args = (request.params?.arguments || {}) as Record<string, any>;
    try {
      if (name === "control_clients") return text(listRemoteClients(owner));
      if (name === "control_start") {
        const client = getRemoteClient(String(args.clientId), owner);
        if (!client) throw new Error("Remote client not found");
        if (client.policy.mode !== "full_access") throw new Error("Set this remote client policy to full_access before starting autonomous control runs");
        return text(createControlRun({ ownerId: owner, clientId: client.id, cwd: String(args.cwd), prompt: String(args.prompt), model: args.model ? String(args.model) : undefined, effort: args.effort ? String(args.effort) : undefined, autoContinue: Boolean(args.autoContinue), maxIterations: args.maxIterations == null ? undefined : Number(args.maxIterations), intervalSeconds: args.intervalSeconds == null ? undefined : Number(args.intervalSeconds), loopPrompt: args.loopPrompt ? String(args.loopPrompt) : undefined, stopMarker: args.stopMarker ? String(args.stopMarker) : undefined }));
      }
      if (name === "control_continue") return text(queueControlInstruction(String(args.runId), owner, String(args.prompt)));
      if (name === "control_status") {
        const run = getControlRun(String(args.runId), owner);
        if (!run) throw new Error("Control run not found");
        return text({ run, events: listControlEvents(run.id, owner, Number(args.eventLimit || 200)), artifacts: listControlArtifacts(run.id, owner).map(({ storagePath: _hidden, ...artifact }) => artifact) });
      }
      if (name === "control_runs") return text(listControlRuns(owner, Number(args.limit || 50)));
      if (name === "control_cancel") return text(requestControlCancel(String(args.runId), owner));
      if (name === "control_inbox") return text(listControlInbox(owner, Number(args.limit || 50)));
      if (name === "control_ack") return text(acknowledgeControlRun(String(args.runId), owner));
      if (name === "control_artifacts") return text(listControlArtifacts(String(args.runId), owner).map(({ storagePath: _hidden, ...artifact }) => artifact));
      if (name === "control_read_artifact") {
        const found = readControlArtifact(String(args.artifactId), owner);
        if (!found) throw new Error("Artifact not found");
        const { artifact, data } = found;
        if (artifact.mimeType.startsWith("image/")) return { content: [{ type: "image", data: data.toString("base64"), mimeType: artifact.mimeType }] } as any;
        if (artifact.mimeType.startsWith("text/") || /json|xml|javascript|typescript|markdown/.test(artifact.mimeType)) return text(data.toString("utf8").slice(0, 2_000_000));
        return text({ artifact: { ...artifact, storagePath: undefined }, base64: data.toString("base64") });
      }
      if (name === "control_remote") {
        const client = getRemoteClient(String(args.clientId), owner);
        if (!client) throw new Error("Remote client not found");
        if (client.policy.mode !== "full_access") throw new Error("Direct MCP remote control requires full_access policy on the selected remote client");
        const result = await requestRemoteClient({ ownerId: owner, clientId: client.id, action: String(args.action) as RemoteAction, params: args.params && typeof args.params === "object" ? args.params : {}, source: "agent", approved: true, timeoutMs: Number(args.timeoutMs || 60_000) });
        return text(result);
      }
      throw new Error(`Unknown control tool: ${String(name)}`);
    } catch (error) {
      return text(error instanceof Error ? error.message : "Control tool failed", true);
    }
  });
  return server;
}

async function readJsonBody(req: any) {
  if (req.body !== undefined) return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function handleControlMcpHttp(req: any, res: any) {
  if (!authorized(req)) {
    res.statusCode = 401;
    res.setHeader("WWW-Authenticate", 'Bearer realm="Metis Control MCP"');
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const body = req.method === "POST" ? await readJsonBody(req).catch(() => undefined) : undefined;
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = createServer(ownerId());
  res.on("close", () => { void transport.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

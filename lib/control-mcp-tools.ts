import { getDatabase } from "@/lib/sqlite";
import {
  createEnrollmentToken,
  getRemoteClient,
  listRemoteClients,
  updateRemoteClient,
  type RemoteAction,
} from "@/lib/remote-clients";
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

export function resolveControlOwnerId() {
  const explicit = process.env.CONTROL_MCP_OWNER_ID?.trim();
  if (explicit) return explicit;
  const row = getDatabase().prepare("SELECT id FROM users WHERE is_admin = 1 ORDER BY created_at ASC LIMIT 1").get() as { id?: string } | undefined;
  if (!row?.id) throw new Error("CONTROL_MCP_OWNER_ID is not configured and no admin user exists");
  return row.id;
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const destructive = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export const controlToolDefinitions = [
  { name: "control_clients", description: "List enrolled remote Metis clients and their live policy/status.", annotations: readOnly, inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "control_create_enrollment", description: "Create a short-lived one-time enrollment token for installing a Metis remote client. The token is shown once and must be handled as a secret.", annotations: write, inputSchema: { type: "object", properties: { ttlSeconds: { type: "integer", minimum: 60, maximum: 3600 } }, additionalProperties: false } },
  { name: "control_set_client_policy", description: "Set the selected remote client's Metis execution policy. Autonomous control_start requires full_access.", annotations: destructive, inputSchema: { type: "object", required: ["clientId", "mode"], properties: { clientId: { type: "string" }, mode: { type: "string", enum: ["restricted", "approval_required", "full_access"] }, allowlist: { type: "array", maxItems: 100, items: { type: "string" } }, name: { type: "string" } }, additionalProperties: false } },
  { name: "control_start", description: "Start a durable Antigravity run on a remote client. With autoContinue it keeps running after the caller disconnects, until the completion marker, iteration limit, or cancellation.", annotations: write, inputSchema: { type: "object", required: ["clientId", "cwd", "prompt"], properties: { clientId: { type: "string" }, cwd: { type: "string" }, prompt: { type: "string" }, model: { type: "string" }, effort: { type: "string", enum: ["low", "medium", "high"] }, autoContinue: { type: "boolean", default: false }, maxIterations: { type: "integer", minimum: 0, maximum: 10000, description: "0 means no iteration limit." }, intervalSeconds: { type: "integer", minimum: 1, maximum: 86400 }, loopPrompt: { type: "string" }, stopMarker: { type: "string" } }, additionalProperties: false } },
  { name: "control_continue", description: "Queue a follow-up instruction on an existing durable run/conversation. Completed runs are reopened and resume their Antigravity conversation.", annotations: write, inputSchema: { type: "object", required: ["runId", "prompt"], properties: { runId: { type: "string" }, prompt: { type: "string" } }, additionalProperties: false } },
  { name: "control_status", description: "Read durable run state, recent events and artifact metadata.", annotations: readOnly, inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" }, eventLimit: { type: "integer", minimum: 1, maximum: 1000 } }, additionalProperties: false } },
  { name: "control_runs", description: "List recent durable control runs.", annotations: readOnly, inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: "control_cancel", description: "Request cancellation of a durable run.", annotations: destructive, inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } }, additionalProperties: false } },
  { name: "control_inbox", description: "List unread completions/updates that happened while the MCP client was disconnected.", annotations: readOnly, inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false } },
  { name: "control_ack", description: "Mark a durable run result as read in the control inbox.", annotations: write, inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } }, additionalProperties: false } },
  { name: "control_artifacts", description: "List text/image/file artifacts captured from a run.", annotations: readOnly, inputSchema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } }, additionalProperties: false } },
  { name: "control_read_artifact", description: "Read a captured artifact. Images are returned as MCP image content; text is returned as text.", annotations: readOnly, inputSchema: { type: "object", required: ["artifactId"], properties: { artifactId: { type: "string" } }, additionalProperties: false } },
  { name: "control_remote", description: "Directly execute a remote-client action. Requires full_access policy on the selected client.", annotations: destructive, inputSchema: { type: "object", required: ["clientId", "action"], properties: { clientId: { type: "string" }, action: { type: "string", enum: ["get_info", "list_directory", "read_file", "write_file", "edit_file", "delete_file", "execute_command", "pty_open", "pty_input", "pty_resize", "pty_close"] }, params: { type: "object", additionalProperties: true }, timeoutMs: { type: "integer", minimum: 1000, maximum: 21660000 } }, additionalProperties: false } },
] as const;

function text(value: unknown, isError = false) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

export async function executeControlTool(owner: string, name: string, args: Record<string, any>) {
  try {
    if (name === "control_clients") return text(listRemoteClients(owner));
    if (name === "control_create_enrollment") {
      const ttlMs = Math.max(60, Math.min(Number(args.ttlSeconds || 900), 3600)) * 1000;
      return text(createEnrollmentToken(owner, ttlMs));
    }
    if (name === "control_set_client_policy") {
      const clientId = String(args.clientId);
      const current = getRemoteClient(clientId, owner);
      if (!current) throw new Error("Remote client not found");
      const mode = String(args.mode) as "restricted" | "approval_required" | "full_access";
      if (!["restricted", "approval_required", "full_access"].includes(mode)) throw new Error("Invalid policy mode");
      const allowlist = Array.isArray(args.allowlist) ? args.allowlist.map(String) : current.policy.allowlist;
      const updated = updateRemoteClient(clientId, owner, { name: args.name ? String(args.name) : current.name, policy: { mode, allowlist } });
      return text(updated);
    }
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
      if (artifact.mimeType.startsWith("image/")) return { content: [{ type: "image" as const, data: data.toString("base64"), mimeType: artifact.mimeType }] };
      if (artifact.mimeType.startsWith("text/") || /json|xml|javascript|typescript|markdown/.test(artifact.mimeType)) return text(data.toString("utf8").slice(0, 2_000_000));
      return text({ artifact: { id: artifact.id, runId: artifact.runId, name: artifact.name, mimeType: artifact.mimeType, size: artifact.size, createdAt: artifact.createdAt }, base64: data.toString("base64") });
    }
    if (name === "control_remote") {
      const client = getRemoteClient(String(args.clientId), owner);
      if (!client) throw new Error("Remote client not found");
      if (client.policy.mode !== "full_access") throw new Error("Direct MCP remote control requires full_access policy on the selected remote client");
      const result = await requestRemoteClient({ ownerId: owner, clientId: client.id, action: String(args.action) as RemoteAction, params: args.params && typeof args.params === "object" ? args.params : {}, source: "agent", approved: true, timeoutMs: Number(args.timeoutMs || 60_000) });
      return text(result);
    }
    throw new Error(`Unknown control tool: ${name}`);
  } catch (error) {
    return text(error instanceof Error ? error.message : "Control tool failed", true);
  }
}

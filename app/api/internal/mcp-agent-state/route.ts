import { appendRunEvent, getJob, listRunEvents, updateJob } from "@/lib/db-jobs";
import { getChat, updateChat } from "@/lib/db-store";
import { bearerTokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 960;

const MAX_WAIT_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function subagentStatuses(chatId: string, userId: string | undefined, jobId: string, afterEventId = 0, agentId?: string) {
  const events = listRunEvents(chatId, userId, afterEventId, jobId);
  const byAgent = new Map<string, Record<string, unknown>>();
  let lastEventId = afterEventId;
  for (const event of events) {
    const item = event as unknown as { id: number; event: string; data: Record<string, unknown>; createdAt: string };
    lastEventId = Math.max(lastEventId, item.id);
    if (item.event !== "tool") continue;
    const data = item.data;
    const subagent = data.subagent as Record<string, unknown> | undefined;
    if (data.kind !== "subagent" && !subagent) continue;
    const candidateId = typeof subagent?.agentId === "string"
      ? subagent.agentId
      : typeof data.agentId === "string"
        ? data.agentId
        : typeof data.callId === "string"
          ? data.callId
          : undefined;
    if (!candidateId || (agentId && candidateId !== agentId)) continue;
    byAgent.set(candidateId, {
      agentId: candidateId,
      name: data.name,
      status: data.status,
      title: subagent?.title,
      model: subagent?.model,
      mode: subagent?.mode,
      updatedAt: item.createdAt,
    });
  }
  return { agents: [...byAgent.values()], lastEventId };
}

export async function POST(req: Request) {
  if (!bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  if (!chatId || !jobId || !getChat(chatId, userId)) {
    return Response.json({ error: "Invalid chat context" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: unknown;
    duration?: unknown;
    durationMs?: unknown;
    reason?: unknown;
    waitMs?: unknown;
    afterEventId?: unknown;
    agentId?: unknown;
  };

  if (body.action === "wait") {
    const presetMs = body.duration === "10s" ? 10_000 : body.duration === "5m" ? 5 * 60_000 : body.duration === "60s" ? 60_000 : undefined;
    const requestedMs = typeof body.durationMs === "number" && Number.isFinite(body.durationMs)
      ? Math.floor(body.durationMs)
      : presetMs;
    if (!requestedMs) return Response.json({ error: "duration must be 10s, 60s, 5m, or durationMs" }, { status: 400 });
    const waitMs = Math.min(MAX_WAIT_MS, Math.max(1_000, requestedMs));
    const waitingUntil = new Date(Date.now() + waitMs).toISOString();
    updateJob(jobId, { status: "waiting_input" });
    updateChat(chatId, { runStatus: "waiting_input", runUpdatedAt: new Date().toISOString() }, userId);
    appendRunEvent(jobId, chatId, userId, "status", { status: "waiting_input", waitingUntil, durationMs: waitMs, reason: body.reason });
    await sleep(waitMs);
    const current = updateJob(jobId, { status: "running" });
    if (!current || current.status !== "running") throw new Error("The agent wait was cancelled.");
    updateChat(chatId, { runStatus: "running", runUpdatedAt: new Date().toISOString() }, userId);
    appendRunEvent(jobId, chatId, userId, "status", { status: "running", reason: "Agent wait finished." });
    return Response.json({ waitedMs: waitMs, waitingUntil });
  }

  if (body.action !== "status") return Response.json({ error: "Unknown action" }, { status: 400 });
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : undefined;
  const afterEventId = typeof body.afterEventId === "number" ? Math.max(0, Math.floor(body.afterEventId)) : 0;
  const waitMs = typeof body.waitMs === "number" ? Math.min(MAX_WAIT_MS, Math.max(0, Math.floor(body.waitMs))) : 0;
  const deadline = Date.now() + waitMs;
  let result = subagentStatuses(chatId, userId, jobId, afterEventId, agentId);
  while (waitMs > 0 && Date.now() < deadline && !result.agents.some((agent) => agent.status !== "running")) {
    await sleep(Math.min(1_000, Math.max(50, deadline - Date.now())));
    result = subagentStatuses(chatId, userId, jobId, result.lastEventId, agentId);
    const job = getJob(jobId);
    if (job && !["running", "queued", "waiting_input", "waiting_for_user"].includes(job.status)) break;
  }
  return Response.json({ ...result, jobStatus: getJob(jobId)?.status || "unknown" });
}

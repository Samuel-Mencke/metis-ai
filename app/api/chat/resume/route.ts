import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getActiveJob, getJob, updateJob } from "@/lib/db-jobs";
import { getChat, updateChat } from "@/lib/db-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const body = (await req.json().catch(() => ({}))) as { chatId?: unknown; jobId?: unknown };
  const chatId = typeof body.chatId === "string" ? body.chatId.trim() : "";
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
  if (getActiveJob(chatId, userId)) return Response.json({ error: "Chat already has an active run" }, { status: 409 });
  const job = jobId ? getJob(jobId) : null;
  if (!job || job.chatId !== chatId || (userId && job.userId && job.userId !== userId)) {
    return Response.json({ error: "Interrupted run not found" }, { status: 404 });
  }
  if (job.status !== "interrupted") return Response.json({ error: "Only interrupted runs can be resumed" }, { status: 409 });
  if (!job.agentId && !chat.agentId) return Response.json({ error: "No safe agent resume marker is available" }, { status: 409 });
  const resumed = updateJob(job.id, {
    status: "queued",
    error: undefined,
    resumePrompt: "The previous run was interrupted. Resume only from the saved agent session state; do not repeat completed tool calls.",
    resumeRequestedAt: new Date().toISOString(),
  });
  updateChat(chatId, { runStatus: "running", runUpdatedAt: new Date().toISOString(), badge: null }, userId);
  return Response.json({ ok: true, jobId: resumed?.id, status: resumed?.status });
}

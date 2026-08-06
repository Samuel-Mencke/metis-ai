import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { enqueueJob, listJobs, listRunEvents } from "@/lib/db-jobs";
import { appendMessage, getChat } from "@/lib/db-store";
import { SSE_HEADERS } from "@/lib/sse";
import { saveAttachments, type IncomingAttachment } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 3600;

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getAuthenticatedUserId(req) ?? undefined;
  const search = new URL(req.url).searchParams;
  const chatId = search.get("chatId") || undefined;
  const jobId = search.get("jobId") || undefined;
  const after = Number(search.get("after") || "0");
  if (chatId && search.get("events") === "1") {
    if (search.get("stream") === "1") {
      const encoder = new TextEncoder();
      let cursor = Number.isFinite(after) ? after : 0;
      let stopped = false;
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: string, data: unknown, id?: number) => {
            if (stopped) return;
            controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          };
          const deadline = Date.now() + 30 * 60 * 1000;
          let lastHeartbeat = Date.now();
          while (Date.now() < deadline) {
            const events = listRunEvents(chatId!, userId, cursor, jobId) as Array<{ id: number; event: string; data: unknown }>;
            for (const event of events) {
              cursor = event.id;
              send(event.event, event.data, event.id);
              if (event.event === "done" || event.event === "error") {
                stopped = true;
                controller.close();
                return;
              }
            }
            if (Date.now() - lastHeartbeat >= 15_000) {
              if (!stopped) controller.enqueue(encoder.encode(": heartbeat\n\n"));
              lastHeartbeat = Date.now();
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (!stopped) controller.close();
        },
        cancel() {
          stopped = true;
        },
      });
      return new Response(stream, { headers: SSE_HEADERS });
    }
    return Response.json({
      events: listRunEvents(chatId, userId, Number.isFinite(after) ? after : 0, jobId),
    });
  }
  return Response.json({ jobs: listJobs(chatId, userId) });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getAuthenticatedUserId(req) ?? undefined;
  const body = (await req.json().catch(() => ({}))) as {
    chatId?: string; message?: string; messageId?: string; referenceText?: string;
    agentId?: string; modelId?: string; modelParams?: Array<{ id: string; value: string }>;
    attachments?: IncomingAttachment[];
  };
  const chatId = body.chatId?.trim();
  const message = body.message?.trim() || "";
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat || (!message && !body.attachments?.length)) {
    return Response.json({ error: "chatId and message or attachments are required" }, { status: 400 });
  }
  let stored = [];
  try {
    stored = body.attachments?.length ? saveAttachments(chat.id, body.attachments).stored : [];
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
  const messageId = body.messageId?.trim();
  appendMessage(chat.id, {
    id: messageId,
    role: "user",
    content: message || "Attached files",
    ...(stored.length ? { attachments: stored } : {}),
  });
  const job = enqueueJob({
    chatId: chat.id,
    userId,
    message,
    ...(messageId ? { messageId } : {}),
    ...(body.referenceText ? { referenceText: body.referenceText.slice(0, 100_000) } : {}),
    ...(body.agentId ? { agentId: body.agentId } : {}),
    ...(body.modelId ? { modelId: body.modelId } : {}),
    ...(body.modelParams ? { modelParams: body.modelParams } : {}),
    ...(stored.length ? { attachments: stored } : {}),
  });
  return Response.json({ job }, { status: 202 });
}

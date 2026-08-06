import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { enqueueJob } from "@/lib/db-jobs";
import { appendMessage, getChat, titleFromMessage, updateChat } from "@/lib/db-store";
import { isModelAllowed } from "@/lib/model-access";
import {
  resolveUploadPath,
  saveAttachments,
  type IncomingAttachment,
  type StoredAttachment,
} from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ChatBody = {
  chatId?: string;
  message?: string;
  messageId?: string;
  referenceText?: string;
  references?: Array<{
    kind?: unknown;
    id?: unknown;
    label?: unknown;
    detail?: unknown;
    path?: unknown;
    content?: unknown;
  }>;
  agentId?: string;
  modelId?: string;
  modelParams?: Array<{ id: string; value: string }>;
  attachments?: IncomingAttachment[];
  storedAttachments?: StoredAttachment[];
};

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const body = (await req.json().catch(() => ({}))) as ChatBody;
  const chatId = body.chatId?.trim();
  const message = body.message?.trim() || "";
  const requestedModelId = body.modelId?.trim();
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  const references = Array.isArray(body.references)
    ? body.references
        .filter((reference) =>
          reference &&
          typeof reference.kind === "string" &&
          typeof reference.id === "string" &&
          typeof reference.label === "string",
        )
        .slice(0, 20)
        .map((reference) => ({
          kind: String(reference.kind).slice(0, 40),
          id: String(reference.id).slice(0, 300),
          label: String(reference.label).slice(0, 300),
          ...(typeof reference.detail === "string" ? { detail: reference.detail.slice(0, 500) } : {}),
          ...(typeof reference.path === "string" ? { path: reference.path.slice(0, 4_000) } : {}),
          ...(typeof reference.content === "string" ? { content: reference.content.slice(0, 8_000) } : {}),
        }))
    : [];
  const referenceText = typeof body.referenceText === "string"
    ? body.referenceText.trim().slice(0, 100_000)
    : "";
  if (!chatId || (!message && !attachments.length)) {
    return Response.json({ error: "chatId and message or attachments are required" }, { status: 400 });
  }
  if (requestedModelId && !isModelAllowed(ownerId, requestedModelId)) {
    return Response.json({ error: "This model is not available for your account" }, { status: 403 });
  }
  const chat = getChat(chatId, ownerId);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });

  const storedAttachments = Array.isArray(body.storedAttachments)
    ? body.storedAttachments
        .filter((attachment): attachment is StoredAttachment =>
          Boolean(attachment) &&
          typeof attachment.id === "string" &&
          typeof attachment.name === "string" &&
          typeof attachment.mimeType === "string" &&
          (attachment.kind === "image" || attachment.kind === "file") &&
          typeof attachment.storedName === "string" &&
          typeof attachment.size === "number" &&
          Boolean(resolveUploadPath(chatId, attachment.storedName)),
        )
        .slice(0, 8)
    : [];
  let stored = [];
  try {
    stored = attachments.length ? saveAttachments(chatId, attachments).stored : [];
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
  const messageId = body.messageId?.trim() || crypto.randomUUID();
  appendMessage(chatId, {
    id: messageId,
    role: "user",
    content: message || `Attached ${stored.length} file${stored.length === 1 ? "" : "s"}`,
    ...(referenceText ? { referenceText } : {}),
    ...(references.length ? { references } : {}),
    ...((stored.length ? stored : storedAttachments).length
      ? { attachments: stored.length ? stored : storedAttachments }
      : {}),
  });
  if (chat.title === "New chat" || !chat.title.trim()) {
    updateChat(chatId, { title: titleFromMessage(message || `Attached ${stored.length} files`) }, ownerId);
  }
  const job = enqueueJob({
    chatId,
    userId: ownerId,
    message,
    messageId,
    ...(body.referenceText ? { referenceText: body.referenceText.slice(0, 100_000) } : {}),
    ...(references.length ? { references } : {}),
    ...(body.agentId ? { agentId: body.agentId } : {}),
    ...(requestedModelId ? { modelId: requestedModelId } : {}),
    ...(body.modelParams ? { modelParams: body.modelParams } : {}),
    ...((stored.length ? stored : storedAttachments).length
      ? { attachments: stored.length ? stored : storedAttachments }
      : {}),
  });
  updateChat(
    chatId,
    { runStatus: "running", runUpdatedAt: new Date().toISOString(), badge: null },
    ownerId,
  );
  return Response.json({ jobId: job.id, runId: job.id, status: job.status }, { status: 202 });
}

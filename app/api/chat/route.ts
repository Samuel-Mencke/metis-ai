import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { captureApiError } from "@/lib/error-logs";
import { enqueueJob, getActiveJob } from "@/lib/db-jobs";
import {
  appendMessageInTransaction,
  getChat,
  titleFromMessage,
  updateChat,
} from "@/lib/db-store";
import { queueChatFollowUp } from "@/lib/chat-queue";
import { isModelAllowed } from "@/lib/model-access";
import { stripRemovedModelParams } from "@/lib/model-params";
import {
  getPinnedNotes,
  resolveReferences,
  type ContextReference,
} from "@/lib/context";
import {
  MAX_ATTACHMENTS,
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
    source?: unknown;
  }>;
  agentId?: string;
  modelId?: string;
  modelParams?: Array<{ id: string; value: string }>;
  attachments?: IncomingAttachment[];
  storedAttachments?: StoredAttachment[];
  incognito?: boolean;
  streamDeviceId?: string;
};

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: ChatBody = {};
  try {
    const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
    body = (await req.json().catch(() => ({}))) as ChatBody;
    const chatId = body.chatId?.trim();
    const message = body.message?.trim() || "";
    const requestedModelId = body.modelId?.trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const hasQueuedAttachmentRequest =
      attachments.length > 0 ||
      (Array.isArray(body.storedAttachments) && body.storedAttachments.length > 0);
    let references = (
      Array.isArray(body.references)
        ? body.references
            .filter(
              (reference) =>
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
              ...(reference.source === "pinned"
                ? { source: "pinned" as const }
                : {}),
              ...(typeof reference.detail === "string"
                ? { detail: reference.detail.slice(0, 500) }
                : {}),
              ...(typeof reference.path === "string"
                ? { path: reference.path.slice(0, 4_000) }
                : {}),
              ...(typeof reference.content === "string"
                ? { content: reference.content.slice(0, 8_000) }
                : {}),
            }))
        : []
    ) as ContextReference[];
    const referenceText =
      typeof body.referenceText === "string"
        ? body.referenceText.trim().slice(0, 100_000)
        : "";
    if (!chatId || (!message && !attachments.length)) {
      return Response.json(
        { error: "chatId and message or attachments are required" },
        { status: 400 },
      );
    }
    if (requestedModelId && !isModelAllowed(ownerId, requestedModelId)) {
      return Response.json(
        { error: "This model is not available for your account" },
        { status: 403 },
      );
    }
    const chat = getChat(chatId, ownerId);
    if (!chat)
      return Response.json({ error: "Chat not found" }, { status: 404 });
    // The persisted chat is the source of truth. The client flag can be stale
    // after switching tabs or restoring an in-memory snapshot.
    if (chat.incognito) {
      references = [];
    }
    const requestedMessageId = body.messageId?.trim() || undefined;
    const resolvedExplicit = resolveReferences(ownerId, chatId, references);
    const pinnedReferences = chat.incognito
      ? []
      : getPinnedNotes(ownerId, chatId);
    const seenReferences = new Set<string>();
    references = [...pinnedReferences, ...resolvedExplicit].filter(
      (reference) => {
        const key = `${reference.kind}:${reference.id}`;
        if (seenReferences.has(key)) return false;
        seenReferences.add(key);
        return true;
      },
    );

    // Questions/approvals are interaction gates, not ordinary running work.
    // Do not hide them behind a queued message: the current run cannot make
    // progress until the user answers the existing request.
    if (
      chat.pendingQuestion ||
      chat.pendingApproval ||
      chat.runStatus === "waiting_input" ||
      chat.runStatus === "waiting_for_user"
    ) {
      return Response.json(
        {
          error:
            "Please answer the agent's question or approval request before starting another run.",
        },
        { status: 409 },
      );
    }

    const queueBehindActiveRun = (activeJobId?: string) => {
      if (!message) {
        return Response.json(
          { error: "A queued follow-up needs text." },
          { status: 409 },
        );
      }
      // The existing durable follow-up queue intentionally stores text and
      // references only. Refuse attachments here rather than silently dropping
      // them. Attachment-aware queueing can be added only when the worker owns
      // the same attachment contract end-to-end.
      if (hasQueuedAttachmentRequest) {
        return Response.json(
          {
            error:
              "Attachments cannot be queued behind an active run yet. Wait for the current run to finish, then send this message with its attachments.",
          },
          { status: 409 },
        );
      }
      const queuedMessageId = requestedMessageId || crypto.randomUUID();
      const queued = queueChatFollowUp(chatId, ownerId, {
        id: queuedMessageId,
        text: message,
        ...(referenceText ? { referenceText } : {}),
        ...(references.length ? { references } : {}),
      });
      if (!queued) {
        return Response.json({ error: "Chat not found" }, { status: 404 });
      }
      return Response.json(
        {
          queued: queued.queued,
          duplicate: queued.duplicate,
          queuedMessageId,
          activeJobId,
          status: "queued",
          queuePosition: queued.position,
          queueMessage:
            queued.position > 0
              ? `Queued follow-up ${queued.position} behind the current run.`
              : "This message was already accepted.",
        },
        { status: 202 },
      );
    };

    const activeJob = getActiveJob(chatId, ownerId);
    if (activeJob) {
      // Network retries reuse messageId. Returning the already accepted job is
      // idempotent; treating the retry as a second run produces random-looking
      // duplicate queue behavior even though the first POST succeeded.
      if (requestedMessageId && activeJob.messageId === requestedMessageId) {
        return Response.json(
          {
            jobId: activeJob.id,
            runId: activeJob.runId || activeJob.id,
            status: activeJob.status,
            queueMessage: activeJob.queueMessage,
          },
          { status: 202 },
        );
      }
      return queueBehindActiveRun(activeJob.id);
    }

    const storedAttachments = Array.isArray(body.storedAttachments)
      ? body.storedAttachments
          .filter(
            (attachment): attachment is StoredAttachment =>
              Boolean(attachment) &&
              typeof attachment.id === "string" &&
              typeof attachment.name === "string" &&
              typeof attachment.mimeType === "string" &&
              (attachment.kind === "image" || attachment.kind === "file") &&
              typeof attachment.storedName === "string" &&
              typeof attachment.size === "number" &&
              Boolean(
                resolveUploadPath(chatId, attachment.storedName, ownerId),
              ),
          )
          .slice(0, MAX_ATTACHMENTS)
      : [];
    let stored = [];
    try {
      stored = attachments.length
        ? saveAttachments(chatId, attachments, ownerId).stored
        : [];
    } catch (error) {
      return Response.json({ error: String(error) }, { status: 400 });
    }
    const messageId = requestedMessageId || crypto.randomUUID();
    const streamDeviceId = body.streamDeviceId?.trim().slice(0, 120)
      || req.headers.get("x-metis-device-id")?.trim().slice(0, 120)
      || undefined;
    const userMessage = {
      id: messageId,
      role: "user" as const,
      content:
        message ||
        `Attached ${stored.length} file${stored.length === 1 ? "" : "s"}`,
      ...(referenceText ? { referenceText } : {}),
      ...(references.length ? { references } : {}),
      ...((stored.length ? stored : storedAttachments).length
        ? { attachments: stored.length ? stored : storedAttachments }
        : {}),
    };
    let job;
    try {
      job = enqueueJob({
        chatId,
        userId: ownerId,
        message,
        messageId,
        ...(chat.incognito
          ? {}
          : body.referenceText
            ? { referenceText: body.referenceText.slice(0, 100_000) }
            : {}),
        ...(references.length ? { references } : {}),
        ...(body.agentId ? { agentId: body.agentId } : {}),
        ...(requestedModelId ? { modelId: requestedModelId } : {}),
        ...(body.modelParams ? { modelParams: stripRemovedModelParams(body.modelParams) ?? [] } : {}),
        ...((stored.length ? stored : storedAttachments).length
          ? { attachments: stored.length ? stored : storedAttachments }
          : {}),
        ...(chat.incognito ? { incognito: true } : {}),
        ...(streamDeviceId ? { streamDeviceId } : {}),
      }, {
        beforeInsert: () => {
          const appended = appendMessageInTransaction(chatId, userMessage, ownerId);
          if (!appended) throw new Error("Chat not found while enqueueing message");
        },
      });
    } catch (error) {
      // Another request can win the active-run race between the optimistic
      // getActiveJob() check above and this transactional enqueue. Text-only
      // follow-ups still enter the same durable FIFO instead of surfacing a
      // random 409 to the user.
      if (error instanceof Error && error.name === "ActiveChatRun") {
        return queueBehindActiveRun(getActiveJob(chatId, ownerId)?.id);
      }
      throw error;
    }
    if (chat.title === "New chat" || !chat.title.trim()) {
      updateChat(
        chatId,
        {
          title: titleFromMessage(message || `Attached ${stored.length} files`),
          titleSource: "default",
        },
        ownerId,
      );
    }
    updateChat(
      chatId,
      {
        runStatus: "running",
        runUpdatedAt: new Date().toISOString(),
        badge: null,
        ...(job.queueMessage
          ? { queueMessage: job.queueMessage }
          : { queueMessage: null }),
      },
      ownerId,
    );
    return Response.json(
      {
        jobId: job.id,
        runId: job.id,
        status: job.status,
        queueMessage: job.queueMessage,
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "ChatQueueFull") {
      return Response.json({ error: error.message }, { status: 429 });
    }
    captureApiError("/api/chat", error, req, { chatId: typeof body === "object" && body ? body.chatId : undefined });
    return Response.json({ error: "Could not send message" }, { status: 500 });
  }
}

import { listJobs, listRunEvents } from "@/lib/db-jobs";
import { getChat } from "@/lib/db-store";

export type ChatLogCategory =
  | "prompt"
  | "response"
  | "tool"
  | "workspace"
  | "stream"
  | "status"
  | "error"
  | "system";

export type ChatLogEntry = {
  id: string;
  timestamp: string;
  category: ChatLogCategory;
  title: string;
  content: string;
  jobId?: string;
  messageId?: string;
  metadata?: unknown;
};

function jsonContent(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function eventCategory(event: string): ChatLogCategory {
  if (event === "error") return "error";
  if (event === "tool") return "tool";
  if (event === "workspace" || event === "canvas") return "workspace";
  if (event === "stream") return "stream";
  if (event === "text" || event === "text-reset" || event === "suggestions") return "response";
  if (event === "status" || event === "done" || event === "question") return "status";
  return "system";
}

function eventContent(event: string, data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (event === "text" && typeof record.text === "string") return record.text;
  if (event === "error" && typeof record.message === "string") return record.message;
  if (event === "status" && typeof record.status === "string") {
    return [record.status, record.message].filter(Boolean).join(" · ");
  }
  return jsonContent(data);
}

export function getChatLogs(chatId: string, ownerId?: string) {
  const chat = getChat(chatId, ownerId);
  if (!chat) return null;
  const entries: ChatLogEntry[] = [];

  for (const message of chat.messages) {
    const category: ChatLogCategory = message.errorMessage
      ? "error"
      : message.role === "user"
        ? "prompt"
        : message.role === "assistant"
          ? "response"
          : "system";
    entries.push({
      id: `message:${message.id}`,
      timestamp: message.createdAt,
      category,
      title: message.errorMessage
        ? "Agent error"
        : message.role === "user"
          ? "User prompt"
          : `${message.role} message`,
      content: message.errorMessage || message.content,
      messageId: message.id,
      ...(
        message.runMetadata || message.errorMessage
          ? {
              metadata: {
                ...(message.runMetadata || {}),
                ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
              },
            }
          : {}
      ),
    });
    for (const tool of message.tools || []) {
      entries.push({
        id: `message-tool:${message.id}:${tool.id}`,
        timestamp: message.createdAt,
        category: "tool",
        title: tool.name,
        content: tool.result || tool.input || "",
        messageId: message.id,
        metadata: tool,
      });
    }
  }

  for (const workspace of chat.workspaces || []) {
    entries.push({
      id: `workspace:${workspace.id}`,
      timestamp: workspace.updatedAt,
      category: "workspace",
      title: `${workspace.type}: ${workspace.name}`,
      content: workspace.content,
      metadata: workspace,
    });
  }

  for (const job of listJobs(chatId, ownerId)) {
    entries.push({
      id: `job:${job.id}`,
      timestamp: job.updatedAt,
      category: job.error ? "error" : "status",
      title: `Job ${job.status}`,
      content: job.error || `Job ${job.status}`,
      jobId: job.id,
      metadata: {
        status: job.status,
        attempts: job.attempts,
        modelId: job.modelId,
        agentId: job.agentId,
      },
    });
  }

  const runEvents = listRunEvents(chatId, ownerId, 0) as Array<{
    id: number;
    jobId: string;
    event: string;
    data: unknown;
    createdAt: string;
  }>;
  for (const event of runEvents) {
    entries.push({
      id: `event:${event.id}`,
      timestamp: event.createdAt,
      category: eventCategory(event.event),
      title: event.event,
      content: eventContent(event.event, event.data),
      jobId: event.jobId,
      metadata: event.data,
    });
  }

  return entries
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))
    .slice(-5_000);
}

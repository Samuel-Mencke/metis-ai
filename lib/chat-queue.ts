import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import { clearStoreCaches } from "@/lib/db-store";
import type { Chat, ChatMessage } from "@/lib/store";

const MAX_QUEUED_FOLLOW_UPS = 50;

export type QueuedChatFollowUp = {
  id: string;
  text: string;
  referenceText?: string;
  references?: ChatMessage["references"];
};

export type QueueChatFollowUpResult = {
  queued: boolean;
  duplicate: boolean;
  position: number;
  message: QueuedChatFollowUp;
};

function sanitizeReference(reference: NonNullable<ChatMessage["references"]>[number]) {
  return {
    kind: reference.kind.slice(0, 40),
    id: reference.id.slice(0, 300),
    label: reference.label.slice(0, 300),
    ...(reference.source === "explicit" || reference.source === "pinned"
      ? { source: reference.source }
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
  };
}

function sanitizeFollowUp(input: QueuedChatFollowUp): QueuedChatFollowUp {
  const id = input.id.trim().slice(0, 200);
  const text = input.text.trim().slice(0, 100_000);
  if (!id || !text) throw new Error("Queued follow-up requires an id and text.");
  return {
    id,
    text,
    ...(input.referenceText?.trim()
      ? { referenceText: input.referenceText.trim().slice(0, 100_000) }
      : {}),
    ...(input.references?.length
      ? {
          references: input.references
            .filter(
              (reference) =>
                reference &&
                typeof reference.id === "string" &&
                typeof reference.kind === "string" &&
                typeof reference.label === "string",
            )
            .slice(0, 20)
            .map(sanitizeReference),
        }
      : {}),
  };
}

export function queueChatFollowUp(
  chatId: string,
  ownerId: string | undefined,
  input: QueuedChatFollowUp,
): QueueChatFollowUpResult | null {
  const followUp = sanitizeFollowUp(input);
  const result = transaction(() => {
    const db = getDatabase();
    const row = ownerId
      ? db.prepare("SELECT data FROM chats WHERE id = ? AND owner_id = ?").get(chatId, ownerId)
      : db.prepare("SELECT data FROM chats WHERE id = ?").get(chatId);
    const chat = parseData<Chat>(row);
    if (!chat) return null;

    if (chat.messages.some((message) => message.id === followUp.id)) {
      return {
        queued: false,
        duplicate: true,
        position: 0,
        message: followUp,
      } satisfies QueueChatFollowUpResult;
    }

    const queue = [...(chat.queuedMessages || [])];
    const duplicateIndex = queue.findIndex((message) => message.id === followUp.id);
    if (duplicateIndex >= 0) {
      return {
        queued: true,
        duplicate: true,
        position: duplicateIndex + 1,
        message: followUp,
      } satisfies QueueChatFollowUpResult;
    }
    if (queue.length >= MAX_QUEUED_FOLLOW_UPS) {
      const error = new Error(`This chat already has ${MAX_QUEUED_FOLLOW_UPS} queued follow-ups.`);
      error.name = "ChatQueueFull";
      throw error;
    }

    queue.push(followUp);
    const next: Chat = {
      ...chat,
      queuedMessages: queue,
    };
    if (ownerId) {
      db.prepare("UPDATE chats SET data = ? WHERE id = ? AND owner_id = ?")
        .run(JSON.stringify(next), chatId, ownerId);
    } else {
      db.prepare("UPDATE chats SET data = ? WHERE id = ?")
        .run(JSON.stringify(next), chatId);
    }
    return {
      queued: true,
      duplicate: false,
      position: queue.length,
      message: followUp,
    } satisfies QueueChatFollowUpResult;
  });
  clearStoreCaches();
  return result;
}

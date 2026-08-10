import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import { config } from "@/lib/config";
import type {
  BrowserContext,
  Chat,
  ChatBadge,
  ChatIndexEntry,
  ChatMessage,
  ChatRunStatus,
  ChatSessionState,
  ChatShare,
  GlobalModelSettings,
  Memory,
  PendingChatQuestion,
  ToolPart,
  WorkspaceItem,
} from "@/lib/store";
import { chatUploadDir, resolveUploadPath } from "@/lib/uploads";

const now = () => new Date().toISOString();
const chatCache = new Map<string, { updatedAt: string; chat: Chat }>();
type ChatPageResult = {
  chat: Chat;
  messageOffset: number;
  hasEarlierMessages: boolean;
  totalMessages: number;
};
const chatPageCache = new Map<string, { updatedAt: string; page: ChatPageResult }>();
const CHAT_PAGE_CACHE_MAX = 128;
let chatIndexCache: { key: string; expiresAt: number; chats: ChatIndexEntry[] } | null = null;

function hashSharePassword(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex")}`;
}

function verifySharePassword(password: string, encoded: string) {
  const [salt, digest] = encoded.split(":");
  if (!salt || !digest) return false;
  const actual = pbkdf2Sync(password, salt, 120_000, 32, "sha256");
  const expected = Buffer.from(digest, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export type PublicChatShare = Omit<ChatShare, "passwordHash"> & { passwordProtected: boolean };

function publicShare(share?: ChatShare): PublicChatShare | undefined {
  if (!share) return undefined;
  return {
    id: share.id,
    active: share.active,
    passwordProtected: Boolean(share.passwordHash),
    content: {
      attachments: share.content?.attachments ?? true,
      thinking: share.content?.thinking ?? false,
      tools: share.content?.tools ?? false,
      suggestions: share.content?.suggestions ?? false,
      sources: share.content?.sources ?? false,
      workspaces: share.content?.workspaces ?? false,
    },
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  };
}

function publicChat(chat: Chat): Omit<Chat, "ownerId"> & { share?: PublicChatShare } {
  const { ownerId: _ownerId, share, ...rest } = chat;
  const content = {
    attachments: share?.content?.attachments ?? true,
    thinking: share?.content?.thinking ?? false,
    tools: share?.content?.tools ?? false,
    suggestions: share?.content?.suggestions ?? false,
    sources: share?.content?.sources ?? false,
    workspaces: share?.content?.workspaces ?? false,
  };
  const messages = rest.messages.map((message) => ({
    ...message,
    content:
      !content.sources && message.role === "assistant"
        ? message.content.replace(/```sources\s*[\s\S]*?```/gi, "").replace(/\n{3,}/g, "\n\n").trim()
        : message.content,
    ...(content.attachments ? {} : { attachments: undefined }),
    ...(content.thinking ? {} : { thinking: undefined }),
    ...(content.tools
      ? {}
      : {
          tools: content.workspaces
            ? message.tools?.filter((tool) => tool.kind === "plan" || tool.kind === "canvas" || tool.kind === "todo")
            : undefined,
        }),
    ...(content.suggestions ? {} : { suggestions: undefined }),
  }));
  return {
    ...rest,
    messages,
    ...(content.workspaces ? {} : { workspaces: undefined, canvas: undefined }),
    ...(publicShare(share) ? { share: publicShare(share) } : {}),
  };
}

function rowChat(row: unknown): Chat | null {
  return parseData<Chat>(row);
}

function parseJsonField<T>(value: unknown): T | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function listChatsForUser(
  ownerId?: string,
  options: { includeArchived?: boolean } = {},
): ChatIndexEntry[] {
  const db = getDatabase();
  const cacheKey = `${ownerId || "*"}:${options.includeArchived ? "all" : "active"}`;
  if (chatIndexCache?.key === cacheKey && chatIndexCache.expiresAt > Date.now()) {
    return chatIndexCache.chats;
  }
  const rows = ownerId
    ? db.prepare(
        `SELECT id, owner_id AS ownerId, created_at AS createdAt, updated_at AS updatedAt,
                json_extract(data, '$.title') AS title,
                json_extract(data, '$.agentId') AS agentId,
                json_extract(data, '$.modelId') AS modelId,
                json_extract(data, '$.runStatus') AS runStatus,
                json_extract(data, '$.runUpdatedAt') AS runUpdatedAt,
                json_extract(data, '$.queueMessage') AS queueMessage,
                json_extract(data, '$.pendingQuestion') AS pendingQuestion,
                json_extract(data, '$.badge') AS badge,
                json_extract(data, '$.pinned') AS pinned,
                json_extract(data, '$.archived') AS archived,
                json_extract(data, '$.share') AS share
         FROM chats WHERE owner_id = ? ORDER BY updated_at DESC`,
      ).all(ownerId)
    : db.prepare(
        `SELECT id, owner_id AS ownerId, created_at AS createdAt, updated_at AS updatedAt,
                json_extract(data, '$.title') AS title,
                json_extract(data, '$.agentId') AS agentId,
                json_extract(data, '$.modelId') AS modelId,
                json_extract(data, '$.runStatus') AS runStatus,
                json_extract(data, '$.runUpdatedAt') AS runUpdatedAt,
                json_extract(data, '$.queueMessage') AS queueMessage,
                json_extract(data, '$.pendingQuestion') AS pendingQuestion,
                json_extract(data, '$.badge') AS badge,
                json_extract(data, '$.pinned') AS pinned,
                json_extract(data, '$.archived') AS archived,
                json_extract(data, '$.share') AS share
         FROM chats ORDER BY updated_at DESC`,
      ).all();
  const result: ChatIndexEntry[] = rows.flatMap((row) => {
      const item = row as Record<string, unknown>;
      const archived = Boolean(item.archived);
      if (!options.includeArchived && archived) return [];
      const pendingQuestion = parseJsonField<PendingChatQuestion>(item.pendingQuestion);
      const share = parseJsonField<ChatShare>(item.share);
      return [{
        id: String(item.id || ""),
        ownerId: typeof item.ownerId === "string" ? item.ownerId : undefined,
        title: typeof item.title === "string" ? item.title : "New chat",
        updatedAt: String(item.updatedAt || ""),
        createdAt: String(item.createdAt || ""),
        ...(typeof item.agentId === "string" ? { agentId: item.agentId } : {}),
        ...(typeof item.modelId === "string" ? { modelId: item.modelId } : {}),
        ...(typeof item.runStatus === "string" ? { runStatus: item.runStatus as ChatRunStatus } : {}),
        ...(typeof item.runUpdatedAt === "string" ? { runUpdatedAt: item.runUpdatedAt } : {}),
        ...(typeof item.queueMessage === "string" ? { queueMessage: item.queueMessage } : {}),
        ...(pendingQuestion ? { pendingQuestion } : {}),
        ...(typeof item.badge === "string" ? { badge: item.badge as ChatBadge } : {}),
        ...(item.pinned === 1 || item.pinned === true ? { pinned: true } : {}),
        ...(archived ? { archived: true } : {}),
        ...(share ? { share: publicShare(share) as ChatIndexEntry["share"] } : {}),
      }];
    })
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  chatIndexCache = { key: cacheKey, expiresAt: Date.now() + 1_000, chats: result };
  return result;
}

export type ChatSearchResult = {
  chatId: string;
  chatTitle: string;
  updatedAt: string;
  messageId?: string;
  role?: ChatMessage["role"];
  snippet: string;
};

export function searchChatsForUser(
  query: string,
  ownerId?: string,
  limit = 30,
): ChatSearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const results: ChatSearchResult[] = [];
  for (const entry of listChatsForUser(ownerId, { includeArchived: true })) {
    const chat = getChat(entry.id, ownerId);
    if (!chat) continue;

    const titleIndex = chat.title.toLowerCase().indexOf(normalized);
    if (titleIndex >= 0) {
      results.push({
        chatId: chat.id,
        chatTitle: chat.title,
        updatedAt: chat.updatedAt,
        snippet: makeSearchSnippet(chat.title, titleIndex, normalized.length),
      });
    }

    for (const message of chat.messages) {
      const content = message.content || "";
      const contentIndex = content.toLowerCase().indexOf(normalized);
      if (contentIndex < 0) continue;
      results.push({
        chatId: chat.id,
        chatTitle: chat.title,
        updatedAt: chat.updatedAt,
        messageId: message.id,
        role: message.role,
        snippet: makeSearchSnippet(content, contentIndex, normalized.length),
      });
      if (results.length >= limit) return results;
    }
  }
  return results.slice(0, limit);
}

function makeSearchSnippet(text: string, index: number, matchLength: number) {
  const start = Math.max(0, index - 70);
  const end = Math.min(text.length, index + matchLength + 110);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "…" : ""}`;
}

export function getChat(id: string, ownerId?: string): Chat | null {
  if (!id || id.includes("/") || id.includes("..")) return null;
  const db = getDatabase();
  const row = ownerId
    ? db.prepare("SELECT data, updated_at as updatedAt FROM chats WHERE id = ? AND owner_id = ?").get(id, ownerId)
    : db.prepare("SELECT data, updated_at as updatedAt FROM chats WHERE id = ?").get(id);
  const updatedAt = (row as { updatedAt?: string } | undefined)?.updatedAt;
  const cached = chatCache.get(id);
  if (cached && cached.updatedAt === updatedAt) {
    return cached.chat.ownerId && ownerId && cached.chat.ownerId !== ownerId ? null : cached.chat;
  }
  const chat = rowChat(row);
  if (chat && updatedAt) chatCache.set(id, { updatedAt, chat });
  return chat && ownerId && chat.ownerId && chat.ownerId !== ownerId ? null : chat;
}

export function getChatPage(
  id: string,
  ownerId: string | undefined,
  messageLimit: number,
  messageOffset: number,
) {
  if (!id || id.includes("/") || id.includes("..")) return null;
  const db = getDatabase();
  const identity = ownerId
    ? db.prepare(
        "SELECT updated_at AS updatedAt FROM chats WHERE id = ? AND owner_id = ?",
      ).get(id, ownerId) as { updatedAt?: string } | undefined
    : db.prepare(
        "SELECT updated_at AS updatedAt FROM chats WHERE id = ?",
      ).get(id) as { updatedAt?: string } | undefined;
  if (!identity?.updatedAt) return null;
  const pageKey = `${ownerId || "*"}:${id}:${messageLimit}:${messageOffset}`;
  const cachedPage = chatPageCache.get(pageKey);
  if (cachedPage?.updatedAt === identity.updatedAt) {
    return cachedPage.page;
  }
  const row = ownerId
    ? db.prepare(
        `SELECT json_remove(data, ?) AS base,
                json_array_length(data, ?) AS total,
                updated_at AS updatedAt
         FROM chats
         WHERE id = ? AND owner_id = ?`,
      ).get("$.messages", "$.messages", id, ownerId) as
      | { base?: string; total?: number; updatedAt?: string }
      | undefined
    : db.prepare(
        `SELECT json_remove(data, ?) AS base,
                json_array_length(data, ?) AS total,
                updated_at AS updatedAt
         FROM chats
         WHERE id = ?`,
      ).get("$.messages", "$.messages", id) as
      | { base?: string; total?: number; updatedAt?: string }
      | undefined;
  if (!row?.base) return null;

  const totalMessages = Math.max(0, Number(row.total) || 0);
  const end = Math.max(0, totalMessages - messageOffset);
  const start = Math.max(0, end - messageLimit);
  const messageRow = ownerId
    ? db.prepare(
        `SELECT COALESCE(json_group_array(json(value)), ?) AS messages
         FROM (
           SELECT value
           FROM chats, json_each(chats.data, ?)
           WHERE chats.id = ? AND chats.owner_id = ?
             AND CAST(json_each.key AS INTEGER) >= ?
             AND CAST(json_each.key AS INTEGER) < ?
           ORDER BY CAST(json_each.key AS INTEGER)
           LIMIT ?
         )`,
      ).get("[]", "$.messages", id, ownerId, start, end, messageLimit) as { messages?: string } | undefined
    : db.prepare(
        `SELECT COALESCE(json_group_array(json(value)), ?) AS messages
         FROM (
           SELECT value
           FROM chats, json_each(chats.data, ?)
           WHERE chats.id = ?
             AND CAST(json_each.key AS INTEGER) >= ?
             AND CAST(json_each.key AS INTEGER) < ?
           ORDER BY CAST(json_each.key AS INTEGER)
           LIMIT ?
         )`,
      ).get("[]", "$.messages", id, start, end, messageLimit) as { messages?: string } | undefined;

  try {
    const base = JSON.parse(row.base) as Omit<Chat, "messages">;
    const messages = JSON.parse(messageRow?.messages || "[]") as ChatMessage[];
    const chat: Chat = { ...base, messages };
    if (row.updatedAt) chat.updatedAt = row.updatedAt;
    const page: ChatPageResult = {
      chat,
      messageOffset,
      hasEarlierMessages: start > 0,
      totalMessages,
    };
    chatPageCache.set(pageKey, { updatedAt: identity.updatedAt, page });
    if (chatPageCache.size > CHAT_PAGE_CACHE_MAX) {
      const oldestKey = chatPageCache.keys().next().value;
      if (oldestKey) chatPageCache.delete(oldestKey);
    }
    return page;
  } catch {
    return null;
  }
}

function saveChatInternal(chat: Chat, options?: { touchUpdatedAt?: boolean }) {
  // `updated_at` is also the cache revision used by getChat/getChatPage.
  // Every JSON mutation must advance it, including workspace/session changes
  // that do not necessarily change the chat title or message activity.
  const updated = options?.touchUpdatedAt === false ? chat : { ...chat, updatedAt: now() };
  getDatabase()
    .prepare(
      `INSERT INTO chats (id, owner_id, data, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, data=excluded.data,
       created_at=excluded.created_at, updated_at=excluded.updated_at`,
    )
    .run(
      updated.id,
      updated.ownerId ?? null,
      JSON.stringify(updated),
      updated.createdAt,
      updated.updatedAt,
    );
  chatCache.set(updated.id, { updatedAt: updated.updatedAt, chat: updated });
  for (const key of chatPageCache.keys()) {
    if (key.includes(`:${updated.id}:`)) chatPageCache.delete(key);
  }
  chatIndexCache = null;
  return updated;
}

export function createChat(
  title = "New chat",
  browserContext?: BrowserContext,
  ownerId?: string,
  model?: { id?: string; params?: Array<{ id: string; value: string }> },
): Chat {
  return transaction(() => {
    const timestamp = now();
    const chat: Chat = {
      id: randomUUID(),
      ...(ownerId ? { ownerId } : {}),
      title: title.trim() || "New chat",
      ...(model?.id ? { modelId: model.id } : {}),
      ...(model?.params?.length ? { modelParams: model.params } : {}),
      messages: [],
      ...(browserContext ? { browserContext: { ...browserContext, updatedAt: timestamp } } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    saveChatInternal(chat);
    return chat;
  });
}

export function saveChat(chat: Chat) {
  return transaction(() => saveChatInternal(chat));
}

export function updateChat(
  id: string,
  patch: {
    title?: string;
    agentId?: string | null;
    modelId?: string | null;
    modelParams?: Array<{ id: string; value: string }> | null;
    queuedMessages?: Array<{ id: string; text: string }> | null;
    pinned?: boolean;
    archived?: boolean;
    canvas?: string | null;
    workspaces?: WorkspaceItem[] | null;
    browserContext?: BrowserContext | null;
    sessionState?: ChatSessionState | null;
    runStatus?: ChatRunStatus;
    runUpdatedAt?: string | null;
    queueMessage?: string | null;
    pendingQuestion?: PendingChatQuestion | null;
    badge?: ChatBadge | null;
    touchUpdatedAt?: boolean;
  },
  ownerId?: string,
) {
  return transaction(() => {
    const chat = getChat(id, ownerId);
    if (!chat) return null;
    const next = { ...chat };
    if (patch.title?.trim()) next.title = patch.title.trim();
    if (patch.agentId === null) delete next.agentId;
    else if (patch.agentId !== undefined) next.agentId = patch.agentId.trim() || undefined;
    if (patch.modelId === null) delete next.modelId;
    else if (patch.modelId !== undefined) next.modelId = patch.modelId.trim() || undefined;
    if (patch.modelParams === null) delete next.modelParams;
    else if (patch.modelParams) next.modelParams = patch.modelParams;
    if (patch.queuedMessages === null) delete next.queuedMessages;
    else if (patch.queuedMessages) next.queuedMessages = patch.queuedMessages;
    if (patch.pinned !== undefined) {
      if (patch.pinned) next.pinned = true;
      else delete next.pinned;
    }
    if (patch.archived !== undefined) {
      if (patch.archived) next.archived = true;
      else delete next.archived;
    }
    if (patch.canvas === null) delete next.canvas;
    else if (patch.canvas !== undefined) next.canvas = patch.canvas;
    if (patch.workspaces === null) {
      delete next.workspaces;
    } else if (patch.workspaces) {
      const names = new Set<string>();
      for (const workspace of patch.workspaces) {
        const key = workspace.name.trim().toLocaleLowerCase();
        if (!key) continue;
        if (names.has(key)) {
          const error = new Error("A workspace with this name already exists.");
          error.name = "WorkspaceNameConflict";
          throw error;
        }
        names.add(key);
      }
      // The browser sends the complete current workspace list. Replacing it
      // is important here: omitted items were explicitly deleted by the user
      // and must not be resurrected from the previous chat snapshot.
      next.workspaces = [...patch.workspaces].slice(-20);
    }
    if (patch.browserContext === null) delete next.browserContext;
    else if (patch.browserContext) next.browserContext = { ...patch.browserContext, updatedAt: now() };
    if (patch.sessionState === null) delete next.sessionState;
    else if (patch.sessionState) next.sessionState = { ...(next.sessionState || {}), ...patch.sessionState };
    if (patch.runStatus) {
      const previousStatus = next.runStatus || "idle";
      if (!canTransitionRunStatus(previousStatus, patch.runStatus)) {
        const error = new Error(`Invalid run state transition: ${previousStatus} -> ${patch.runStatus}`);
        error.name = "InvalidRunStateTransition";
        throw error;
      }
      next.runStatus = patch.runStatus;
      next.runUpdatedAt = patch.runUpdatedAt || now();
    } else if (patch.runUpdatedAt === null) delete next.runUpdatedAt;
    if (patch.queueMessage === null) delete next.queueMessage;
    else if (patch.queueMessage !== undefined) next.queueMessage = patch.queueMessage.trim().slice(0, 200) || undefined;
    if (patch.pendingQuestion === null) delete next.pendingQuestion;
    else if (patch.pendingQuestion) next.pendingQuestion = patch.pendingQuestion;
    if (patch.badge === null) delete next.badge;
    else if (patch.badge) next.badge = patch.badge;
    return saveChatInternal(next, { touchUpdatedAt: patch.touchUpdatedAt !== false });
  });
}

const RUN_STATUS_TRANSITIONS: Record<ChatRunStatus, readonly ChatRunStatus[]> = {
  idle: ["idle", "running", "paused", "waiting_for_user", "waiting_input", "cancelled", "interrupted", "completed", "failed", "error"],
  running: ["running", "paused", "waiting_for_user", "waiting_input", "completed", "cancelled", "interrupted", "failed", "error"],
  paused: ["paused", "running", "cancelled", "interrupted", "failed", "error"],
  waiting_for_user: ["waiting_for_user", "running", "cancelled", "interrupted", "failed", "error"],
  waiting_input: ["waiting_input", "running", "cancelled", "interrupted", "failed", "error"],
  completed: ["completed", "running", "cancelled"],
  cancelled: ["cancelled", "running"],
  failed: ["failed", "running", "cancelled"],
  interrupted: ["interrupted", "running", "cancelled", "failed"],
  error: ["error", "running", "cancelled"],
};

export function canTransitionRunStatus(from: ChatRunStatus, to: ChatRunStatus) {
  return RUN_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function deleteChat(id: string, ownerId?: string) {
  return transaction(() => {
    if (!getChat(id, ownerId)) return false;
    return getDatabase().prepare("DELETE FROM chats WHERE id = ?").run(id).changes > 0;
  });
}

export function updateChatShare(
  chatId: string,
  patch: {
    active?: boolean;
    password?: string | null;
    content?: ChatShare["content"];
  },
  ownerId?: string,
) {
  return transaction(() => {
    const chat = getChat(chatId, ownerId);
    if (!chat) return null;
    const timestamp = now();
    const current = chat.share;
    const share: ChatShare = {
      id: current?.id || randomUUID(),
      active: patch.active ?? current?.active ?? true,
      createdAt: current?.createdAt || timestamp,
      updatedAt: timestamp,
      ...(current?.passwordHash ? { passwordHash: current.passwordHash } : {}),
      ...(current?.content ? { content: { ...current.content } } : {}),
    };
    if (patch.password !== undefined) {
      if (patch.password?.trim()) share.passwordHash = hashSharePassword(patch.password.trim());
      else delete share.passwordHash;
    }
    if (patch.content) {
      share.content = {
        attachments: Boolean(patch.content.attachments),
        thinking: Boolean(patch.content.thinking),
        tools: Boolean(patch.content.tools),
        suggestions: Boolean(patch.content.suggestions),
        sources: Boolean(patch.content.sources),
        workspaces: Boolean(patch.content.workspaces),
      };
    }
    chat.share = share;
    return saveChatInternal(chat);
  });
}

export function deleteChatShare(chatId: string, ownerId?: string) {
  return transaction(() => {
    const chat = getChat(chatId, ownerId);
    if (!chat) return null;
    if (!chat.share) return chat;
    delete chat.share;
    return saveChatInternal(chat);
  });
}

export function getChatByShareId(shareId: string, password?: string) {
  if (!shareId.trim()) return { status: "not_found" as const };
  const rows = getDatabase().prepare("SELECT data FROM chats").all();
  const chat = rows
    .map((row) => rowChat(row))
    .find((candidate) => candidate?.share?.id === shareId.trim() && candidate.share.active);
  if (!chat?.share || !chat.share.active) return { status: "not_found" as const };
  if (chat.share.passwordHash && (!password || !verifySharePassword(password, chat.share.passwordHash))) {
    return { status: "password_required" as const, share: publicShare(chat.share) };
  }
  return { status: "ok" as const, chat: publicChat(chat), ownerId: chat.ownerId };
}

export function cloneChatByShareId(shareId: string, password: string | undefined, ownerId: string) {
  return transaction(() => {
    if (!shareId.trim() || !ownerId) return { status: "not_found" as const };
    const rows = getDatabase().prepare("SELECT data FROM chats").all();
    const source = rows
      .map((row) => rowChat(row))
      .find((candidate) => candidate?.share?.id === shareId.trim() && candidate.share.active);
    if (!source?.share || (source.share.passwordHash && (!password || !verifySharePassword(password, source.share.passwordHash)))) {
      return { status: "not_found" as const };
    }

    const timestamp = now();
    const clonedId = randomUUID();
    const cloned: Chat = {
      ...source,
      id: clonedId,
      ownerId,
      createdAt: timestamp,
      updatedAt: timestamp,
      runStatus: "idle",
    };
    delete cloned.share;
    delete cloned.agentId;
    delete cloned.runUpdatedAt;
    delete cloned.pendingQuestion;

    const attachments = cloned.messages.flatMap((message) => message.attachments || []);
    if (attachments.length) {
      const targetDir = chatUploadDir(clonedId, ownerId);
      mkdirSync(targetDir, { recursive: true });
      for (const attachment of attachments) {
        const sourcePath = resolveUploadPath(source.id, attachment.storedName, source.ownerId);
        if (sourcePath && existsSync(sourcePath)) {
          copyFileSync(sourcePath, path.join(targetDir, path.basename(attachment.storedName)));
        }
      }
    }
    saveChatInternal(cloned);
    return { status: "ok" as const, chat: cloned };
  });
}

export function appendMessage(
  chatId: string,
  message: Omit<ChatMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
) {
  return transaction(() => {
    const chat = getChat(chatId);
    if (!chat) return null;
    const id = message.id || randomUUID();
    if (chat.messages.some((item) => item.id === id)) return chat;
    chat.messages.push({
      ...message,
      id,
      createdAt: message.createdAt || now(),
    });
    return saveChatInternal(chat);
  });
}

export function upsertMessage(chatId: string, message: Omit<ChatMessage, "createdAt"> & { createdAt?: string }) {
  return transaction(() => {
    const chat = getChat(chatId);
    if (!chat) return null;
    const index = chat.messages.findIndex((item) => item.id === message.id);
    const next = { ...message, createdAt: message.createdAt || chat.messages[index]?.createdAt || now() };
    if (index >= 0) chat.messages[index] = next;
    else chat.messages.push(next);
    return saveChatInternal(chat);
  });
}

export const titleFromMessage = (content: string) => {
  const cleaned = content.replace(/\s+/g, " ").trim();
  return cleaned ? (cleaned.length > 48 ? `${cleaned.slice(0, 48)}…` : cleaned) : "New chat";
};

export function listMemories(ownerId?: string): Memory[] {
  const query = ownerId
    ? "SELECT data FROM memories WHERE owner_id = ? ORDER BY updated_at ASC"
    : "SELECT data FROM memories ORDER BY updated_at ASC";
  return getDatabase()
    .prepare(query)
    .all(...(ownerId ? [ownerId] : []))
    .map((row) => parseData<Memory>(row))
    .filter((memory): memory is Memory => Boolean(memory));
}

export function saveMemories(memories: Memory[], ownerId?: string) {
  transaction(() => {
    const db = getDatabase();
    if (ownerId) db.prepare("DELETE FROM memories WHERE owner_id = ?").run(ownerId);
    else db.prepare("DELETE FROM memories").run();
    const insert = db.prepare("INSERT INTO memories (id, owner_id, data, updated_at) VALUES (?, ?, ?, ?)");
    for (const memory of memories) insert.run(memory.id, ownerId ?? null, JSON.stringify(memory), memory.updatedAt);
  });
}

export function getGlobalModelSettings(ownerId?: string): GlobalModelSettings {
  const row = getDatabase().prepare("SELECT data FROM settings WHERE key = ?").get(ownerId ? `global:${ownerId}` : "global");
  return parseData<GlobalModelSettings>({ data: (row as { data?: string } | undefined)?.data }) || {};
}

export function saveGlobalModelSettings(settings: GlobalModelSettings, ownerId?: string) {
  getDatabase()
    .prepare("INSERT OR REPLACE INTO settings (key, owner_id, data) VALUES (?, ?, ?)")
    .run(ownerId ? `global:${ownerId}` : "global", ownerId ?? null, JSON.stringify(settings));
  return settings;
}

export function createMemory(content: string, tags?: string[], ownerId?: string): Memory {
  const memory: Memory = { id: randomUUID(), content: content.trim(), tags, createdAt: now(), updatedAt: now() };
  saveMemories([...listMemories(ownerId), memory], ownerId);
  return memory;
}

export function updateMemory(id: string, patch: { content?: string; tags?: string[] }, ownerId?: string) {
  const memory = listMemories(ownerId).find((item) => item.id === id);
  if (!memory) return null;
  const updated = { ...memory, ...patch, updatedAt: now() };
  saveMemories(listMemories(ownerId).map((item) => (item.id === id ? updated : item)), ownerId);
  return updated;
}

export function deleteMemory(id: string, ownerId?: string) {
  const memories = listMemories(ownerId);
  const next = memories.filter((item) => item.id !== id);
  if (next.length === memories.length) return false;
  saveMemories(next, ownerId);
  return true;
}

export function buildSystemContext(memories: Memory[]) {
  return `[SYSTEM CONTEXT]\nMemories:\n${memories.map((memory) => `- ${memory.content}`).join("\n") || "(none yet)"}`;
}

export function getDataPaths() {
  return { DATA_DIR: config.dataDir, databasePath: config.databasePath };
}

export type { BrowserContext, Chat, ChatIndexEntry, ChatMessage, GlobalModelSettings, Memory, PendingChatQuestion, ToolPart, WorkspaceItem };

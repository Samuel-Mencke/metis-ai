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

export function listChatsForUser(
  ownerId?: string,
  options: { includeArchived?: boolean } = {},
): ChatIndexEntry[] {
  const db = getDatabase();
  const rows = ownerId
    ? db.prepare("SELECT data FROM chats WHERE owner_id = ? ORDER BY updated_at DESC").all(ownerId)
    : db.prepare("SELECT data FROM chats ORDER BY updated_at DESC").all();
  return rows
    .map((row) => rowChat(row))
    .filter((chat): chat is Chat => Boolean(chat))
    .filter((chat) => options.includeArchived || !chat.archived)
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      const aLastSentMessage = a.messages.filter((message) => message.role === "user").at(-1)?.createdAt || "";
      const bLastSentMessage = b.messages.filter((message) => message.role === "user").at(-1)?.createdAt || "";
      if (Boolean(aLastSentMessage) !== Boolean(bLastSentMessage)) {
        return aLastSentMessage ? -1 : 1;
      }
      return (bLastSentMessage || b.createdAt).localeCompare(aLastSentMessage || a.createdAt);
    })
    .map((chat) => ({
      id: chat.id,
      ownerId: chat.ownerId,
      title: chat.title,
      updatedAt: chat.updatedAt,
      createdAt: chat.createdAt,
      agentId: chat.agentId,
      modelId: chat.modelId,
      runStatus: chat.runStatus,
      runUpdatedAt: chat.runUpdatedAt,
      pendingQuestion: chat.pendingQuestion,
      badge: chat.badge,
      pinned: chat.pinned,
      archived: chat.archived,
      ...(chat.share ? { share: publicShare(chat.share) } : {}),
    }));
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
    ? db.prepare("SELECT data FROM chats WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)").get(id, ownerId)
    : db.prepare("SELECT data FROM chats WHERE id = ?").get(id);
  const chat = rowChat(row);
  return chat && ownerId && chat.ownerId && chat.ownerId !== ownerId ? null : chat;
}

function saveChatInternal(chat: Chat) {
  const updated = { ...chat, updatedAt: now() };
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
    pendingQuestion?: PendingChatQuestion | null;
    badge?: ChatBadge | null;
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
      next.runStatus = patch.runStatus;
      next.runUpdatedAt = patch.runUpdatedAt || now();
    } else if (patch.runUpdatedAt === null) delete next.runUpdatedAt;
    if (patch.pendingQuestion === null) delete next.pendingQuestion;
    else if (patch.pendingQuestion) next.pendingQuestion = patch.pendingQuestion;
    if (patch.badge === null) delete next.badge;
    else if (patch.badge) next.badge = patch.badge;
    return saveChatInternal(next);
  });
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

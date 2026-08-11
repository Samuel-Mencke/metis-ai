import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat, listChatsForUser, listMemories } from "@/lib/db-store";
import { config } from "@/lib/config";
import { listNotes } from "@/lib/shared-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReferenceKind = "file" | "canvas" | "plan" | "note" | "browser" | "memory" | "chat" | "terminal";

type ReferenceResult = {
  kind: ReferenceKind;
  id: string;
  label: string;
  detail?: string;
  chatId?: string;
  isCurrentChat?: boolean;
  path?: string;
  content?: string;
  sessionId?: string;
};

function matches(query: string, ...values: Array<string | undefined>) {
  if (!query) return true;
  const haystack = values.filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 200);
  const kind = url.searchParams.get("kind") as ReferenceKind | null;
  const currentChatId = url.searchParams.get("chatId") || "";
  const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
  const results: ReferenceResult[] = [];

  const push = (item: ReferenceResult) => {
    if ((!kind || item.kind === kind) && matches(query, item.label, item.detail, item.path, item.content)) {
      results.push(item);
    }
  };

  for (const entry of listChatsForUser(ownerId)) {
    const chat = getChat(entry.id, ownerId);
    if (!chat) continue;
    push({
      kind: "chat",
      id: chat.id,
      label: chat.title || "Untitled chat",
      detail: `${chat.messages.length} messages${chat.keywords?.length ? ` · ${chat.keywords.join(" · ")}` : ""}`,
      chatId: chat.id,
      isCurrentChat: chat.id === currentChatId,
    });

    for (const workspace of chat.workspaces || []) {
      push({
        kind: workspace.type,
        id: workspace.id,
        label: workspace.name,
        detail: `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        content: workspace.content.slice(0, 6_000),
      });
    }

    for (const note of listNotes({ ownerId, chatId: chat.id }).filter(
      (item) => item.scope === "chat" || chat.id === currentChatId,
    )) {
      push({
        kind: "note",
        id: note.id,
        label: note.title || note.content.slice(0, 80) || "Untitled note",
        detail: `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        content: note.content.slice(0, 6_000),
      });
    }

    for (const tab of chat.browserContext?.tabs || []) {
      if (!tab.url && tab.title === "New tab") continue;
      push({
        kind: "browser",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || tab.url || "Browser tab",
        detail: tab.url || `in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.url,
      });
    }

    for (const tab of chat.sessionState?.terminalTabs || []) {
      push({
        kind: "terminal",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || "Terminal",
        detail: `${tab.cwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: tab.cwd,
        sessionId: tab.sessionId,
      });
    }
    if (!chat.sessionState?.terminalTabs?.length && chat.sessionState?.terminalSessionId) {
      push({
        kind: "terminal",
        id: `${chat.id}:terminal-1`,
        label: "Terminal 1",
        detail: `${chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd} · in ${chat.title || "Untitled chat"}`,
        chatId: chat.id,
        isCurrentChat: chat.id === currentChatId,
        path: chat.sessionState.terminalCwd || chat.sessionState.remoteCwd || config.agentCwd,
        sessionId: chat.sessionState.terminalSessionId,
      });
    }

    for (const message of chat.messages) {
      for (const attachment of message.attachments || []) {
        push({
          kind: "file",
          id: `${chat.id}:${attachment.id}`,
          label: attachment.name,
          detail: `in ${chat.title || "Untitled chat"}`,
          chatId: chat.id,
          isCurrentChat: chat.id === currentChatId,
          path: attachment.storedName,
        });
      }
      for (const tool of message.tools || []) {
        if (!tool.path) continue;
        push({
          kind: "file",
          id: `${chat.id}:${tool.id}`,
          label: tool.path.split("/").pop() || tool.path,
          detail: tool.name,
          chatId: chat.id,
          isCurrentChat: chat.id === currentChatId,
          path: tool.path,
          content: (tool.result || tool.detail || "").slice(0, 6_000),
        });
      }
    }
  }

  if (!kind || kind === "memory") {
    for (const memory of listMemories(ownerId)) {
      push({
        kind: "memory",
        id: memory.id,
        label: memory.content.slice(0, 160),
        detail: memory.tags?.join(" · "),
        content: memory.content,
      });
    }
  }

  if (!kind || kind === "note") {
    for (const note of listNotes({ ownerId, scope: "global" })) {
      push({
        kind: "note",
        id: note.id,
        label: note.title || note.content.slice(0, 80) || "Untitled note",
        detail: "Global note",
        content: note.content.slice(0, 6_000),
      });
    }
  }

  return Response.json({ results: results.slice(0, 80), currentChatId });
}

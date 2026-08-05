import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat, listChatsForUser, listMemories } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReferenceKind = "file" | "canvas" | "plan" | "browser" | "memory" | "chat";

type ReferenceResult = {
  kind: ReferenceKind;
  id: string;
  label: string;
  detail?: string;
  path?: string;
  content?: string;
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
      detail: `${chat.messages.length} messages`,
    });

    for (const workspace of chat.workspaces || []) {
      push({
        kind: workspace.type,
        id: workspace.id,
        label: workspace.name,
        detail: `in ${chat.title || "Untitled chat"}`,
        content: workspace.content.slice(0, 6_000),
      });
    }

    for (const tab of chat.browserContext?.tabs || []) {
      if (!tab.url && tab.title === "New tab") continue;
      push({
        kind: "browser",
        id: `${chat.id}:${tab.id}`,
        label: tab.title || tab.url || "Browser tab",
        detail: tab.url || `in ${chat.title || "Untitled chat"}`,
        path: tab.url,
      });
    }

    for (const message of chat.messages) {
      for (const attachment of message.attachments || []) {
        push({
          kind: "file",
          id: `${chat.id}:${attachment.id}`,
          label: attachment.name,
          detail: `in ${chat.title || "Untitled chat"}`,
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
          path: tool.path,
          content: (tool.result || tool.detail || "").slice(0, 6_000),
        });
      }
    }
  }

  if (!kind || kind === "memory") {
    for (const memory of listMemories()) {
      push({
        kind: "memory",
        id: memory.id,
        label: memory.content.slice(0, 160),
        detail: memory.tags?.join(" · "),
        content: memory.content,
      });
    }
  }

  return Response.json({ results: results.slice(0, 80), currentChatId });
}

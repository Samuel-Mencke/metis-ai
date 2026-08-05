import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  deleteChat,
  getChat,
  updateChat,
  type BrowserContext,
  type PendingChatQuestion,
  type WorkspaceItem,
} from "@/lib/db-store";
import type { ChatSessionState } from "@/lib/store";
import type { ChatBadge } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const chat = getChat(id, ownerId);
  if (!chat) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const searchParams = new URL(req.url).searchParams;
  const requestedLimit = Number(searchParams.get("messageLimit") || "10");
  const requestedOffset = Number(searchParams.get("messageOffset") || "0");
  const messageLimit = Number.isFinite(requestedLimit)
    ? Math.min(100, Math.max(1, Math.floor(requestedLimit)))
    : 10;
  const messageOffset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.floor(requestedOffset))
    : 0;
  const end = Math.max(0, chat.messages.length - messageOffset);
  const start = Math.max(0, end - messageLimit);
  const messages = chat.messages.slice(start, end);
  const responseChat = { ...chat, messages };
  return Response.json({
    chat: responseChat,
    messageOffset,
    hasEarlierMessages: start > 0,
    totalMessages: chat.messages.length,
  });
}

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  let body: {
    title?: string;
    agentId?: string | null;
    modelId?: string | null;
    modelParams?: Array<{ id: string; value: string }> | null;
    queuedMessages?: Array<{ id: string; text: string }> | null;
    canvas?: string | null;
    workspaces?: WorkspaceItem[] | null;
    browserContext?: BrowserContext | null;
    sessionState?: ChatSessionState | null;
    pendingQuestion?: PendingChatQuestion | null;
    badge?: ChatBadge | null;
  };
  try {
    body = (await req.json()) as {
      title?: string;
      agentId?: string | null;
      modelId?: string | null;
      modelParams?: Array<{ id: string; value: string }> | null;
      queuedMessages?: Array<{ id: string; text: string }> | null;
      canvas?: string | null;
      workspaces?: WorkspaceItem[] | null;
      browserContext?: BrowserContext | null;
      sessionState?: ChatSessionState | null;
      pendingQuestion?: PendingChatQuestion | null;
      badge?: ChatBadge | null;
    };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let chat;
  try {
    chat = updateChat(id, body, ownerId);
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceNameConflict") {
      return Response.json({ error: "Ein Plan mit diesem Namen existiert bereits" }, { status: 409 });
    }
    throw error;
  }
  if (!chat) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ chat });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  if (!deleteChat(id, ownerId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

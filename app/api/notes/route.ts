import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChat, getGlobalModelSettings } from "@/lib/db-store";
import {
  createNote,
  listNotes,
  type NoteWriteInput,
} from "@/lib/shared-context";
import { featureFlags } from "@/lib/feature-flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inputFromBody(body: Record<string, unknown>): NoteWriteInput {
  const position = body.position && typeof body.position === "object" ? body.position as Record<string, unknown> : undefined;
  const size = body.size && typeof body.size === "object" ? body.size as Record<string, unknown> : undefined;
  return {
    title: typeof body.title === "string" ? body.title : undefined,
    content: typeof body.content === "string" ? body.content : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    scope: body.scope === "global" || body.scope === "chat" || body.scope === "workspace" ? body.scope : undefined,
    chatId: typeof body.chatId === "string" ? body.chatId.trim() : undefined,
    workspaceId: typeof body.workspaceId === "string" ? body.workspaceId.trim() : undefined,
    position: position ? { x: Number(position.x), y: Number(position.y) } : undefined,
    size: size ? { width: Number(size.width), height: Number(size.height) } : undefined,
    archived: typeof body.archived === "boolean" ? body.archived : undefined,
    author: body.author === "agent" ? "agent" : "user",
  };
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const settings = featureFlags(getGlobalModelSettings(userId));
  if (!settings.notes) return Response.json({ error: "Notes are disabled" }, { status: 404 });
  const url = new URL(req.url);
  const chatId = url.searchParams.get("chatId")?.trim() || undefined;
  const workspaceId = url.searchParams.get("workspaceId")?.trim() || undefined;
  if (chatId && !getChat(chatId, userId)) return Response.json({ error: "Chat not found" }, { status: 404 });
  return Response.json({
    notes: listNotes({
      ownerId: userId,
      chatId,
      workspaceId,
      scope: url.searchParams.get("scope") as NoteWriteInput["scope"] || undefined,
      includeArchived: url.searchParams.get("includeArchived") === "true",
      search: url.searchParams.get("search") || undefined,
    }),
  });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  if (!featureFlags(getGlobalModelSettings(userId)).notes) return Response.json({ error: "Notes are disabled" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = inputFromBody(body);
  if (input.chatId && !getChat(input.chatId, userId)) return Response.json({ error: "Chat not found" }, { status: 404 });
  try {
    const note = createNote({
      ...input,
      ownerId: userId,
      idempotencyKey: req.headers.get("idempotency-key") || undefined,
    });
    return Response.json({ note }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create note" }, { status: 400 });
  }
}

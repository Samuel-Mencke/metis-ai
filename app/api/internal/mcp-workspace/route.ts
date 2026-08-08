import { randomUUID } from "node:crypto";
import { getChat, updateChat, type WorkspaceItem } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceType = "plan" | "canvas";

function authorized(req: Request) {
  const configured = process.env.MCP_BEARER_TOKEN?.trim() || "";
  const supplied = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return Boolean(configured && supplied && configured === supplied);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  if (!chatId || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = body.type === "plan" || body.type === "canvas" ? body.type : null;

  const chat = getChat(chatId, userId);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });

  const existingId = typeof body.id === "string" ? body.id.trim() : "";
  if (body.action === "list") {
    return Response.json({
      workspaces: type ? (chat.workspaces || []).filter((item) => item.type === type) : (chat.workspaces || []),
    });
  }
  if (body.action === "delete") {
    if (!existingId) return Response.json({ error: "id is required" }, { status: 400 });
    const existing = (chat.workspaces || []).find((item) => item.id === existingId && (!type || item.type === type));
    if (!existing) return Response.json({ error: "Workspace not found" }, { status: 404 });
    updateChat(chatId, { workspaces: (chat.workspaces || []).filter((item) => item.id !== existingId) }, userId);
    return Response.json({ ok: true, id: existingId });
  }
  if (!type) return Response.json({ error: "type must be plan or canvas" }, { status: 400 });
  if (existingId && (body.action === "edit" || body.action === "update")) {
    const existing = (chat.workspaces || []).find((item) => item.id === existingId && item.type === type);
    if (!existing) return Response.json({ error: "Workspace not found" }, { status: 404 });
    const updated: WorkspaceItem = {
      ...existing,
      ...(typeof body.title === "string" ? { name: body.title.trim().slice(0, 200) || existing.name } : {}),
      ...(typeof body.content === "string" ? { content: body.content.slice(0, 100_000) } : {}),
      updatedAt: new Date().toISOString(),
    };
    updateChat(chatId, {
      workspaces: (chat.workspaces || []).map((item) => item.id === existingId ? updated : item),
    }, userId);
    return Response.json({ ...updated, workspaceLink: `workspace://${type}/${updated.id}` });
  }

  const defaultName = type === "plan" ? "Plan" : "Canvas";
  const requestedName = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const content = typeof body.content === "string" ? body.content.slice(0, 100_000) : "";
  const names = new Set(
    (chat.workspaces || [])
      .filter((item) => item.type === type)
      .map((item) => item.name.trim().toLocaleLowerCase()),
  );
  let name = requestedName || defaultName;
  if (names.has(name.toLocaleLowerCase())) {
    let suffix = 2;
    const baseName = name;
    while (names.has(`${baseName} (${suffix})`.toLocaleLowerCase())) suffix += 1;
    name = `${baseName} (${suffix})`.slice(0, 200);
  }

  const timestamp = new Date().toISOString();
  const workspace: WorkspaceItem = {
    id: randomUUID(),
    type,
    name,
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  updateChat(
    chatId,
    { workspaces: [...(chat.workspaces || []), workspace].slice(-20) },
    userId,
  );
  return Response.json({
    ...workspace,
    workspaceLink: `workspace://${type}/${workspace.id}`,
  });
}

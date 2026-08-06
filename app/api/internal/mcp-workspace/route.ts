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
  if (!type) return Response.json({ error: "type must be plan or canvas" }, { status: 400 });

  const chat = getChat(chatId, userId);
  if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });

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

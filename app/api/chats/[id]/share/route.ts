import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { deleteChatShare, updateChatShare } from "@/lib/db-store";
import type { ChatShare } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { active?: boolean; password?: string | null; content?: ChatShare["content"] };
  try {
    body = (await req.json()) as { active?: boolean; password?: string | null; content?: ChatShare["content"] };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.active !== undefined && typeof body.active !== "boolean") {
    return Response.json({ error: "active must be a boolean" }, { status: 400 });
  }
  if (body.password !== undefined && body.password !== null && typeof body.password !== "string") {
    return Response.json({ error: "password must be a string or null" }, { status: 400 });
  }

  const { id } = await params;
  const chat = updateChatShare(id, body, await getAuthenticatedUserId(req) ?? undefined);
  if (!chat?.share) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    share: {
      id: chat.share.id,
      active: chat.share.active,
      passwordProtected: Boolean(chat.share.passwordHash),
      content: chat.share.content,
      createdAt: chat.share.createdAt,
      updatedAt: chat.share.updatedAt,
    },
  });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const chat = deleteChatShare(id, await getAuthenticatedUserId(req) ?? undefined);
  if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

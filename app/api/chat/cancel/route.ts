import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { requestJobCancel } from "@/lib/db-jobs";
import { getChat, updateChat } from "@/lib/db-store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { chatId?: string };
  const chatId = body.chatId?.trim();
  if (!chatId) return Response.json({ error: "chatId is required" }, { status: 400 });
  const userId = await getAuthenticatedUserId(req) ?? undefined;
  if (!getChat(chatId, userId)) return Response.json({ error: "Not found" }, { status: 404 });

  const cancelled = requestJobCancel(chatId, userId);
  if (!cancelled) return Response.json({ error: "No active run" }, { status: 404 });
  updateChat(chatId, {
    runStatus: "cancelled",
    runUpdatedAt: new Date().toISOString(),
  }, userId);
  return Response.json({ ok: true, status: "cancel-requested" });
}

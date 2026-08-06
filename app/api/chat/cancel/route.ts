import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { requestJobCancel } from "@/lib/db-jobs";
import { getChat, updateChat, upsertMessage } from "@/lib/db-store";

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
  if (!cancelled) {
    const chat = getChat(chatId, userId);
    if (
      chat?.runStatus !== "running" &&
      chat?.runStatus !== "waiting_input" &&
      chat?.runStatus !== "cancelled"
    ) {
      return Response.json({ error: "No active run" }, { status: 404 });
    }
  }
  const chat = getChat(chatId, userId);
  const latestAssistant = [...(chat?.messages || [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.tools?.some((tool) => tool.status === "running"));
  if (latestAssistant?.tools) {
    upsertMessage(chatId, {
      ...latestAssistant,
      tools: latestAssistant.tools.map((tool) =>
        tool.status === "running" ? { ...tool, status: "cancelled" } : tool,
      ),
    });
  }
  updateChat(chatId, {
    runStatus: "cancelled",
    runUpdatedAt: new Date().toISOString(),
  }, userId);
  return Response.json({ ok: true, status: "cancel-requested" });
}

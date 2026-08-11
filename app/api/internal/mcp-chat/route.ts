import {
  getChat,
  normalizeChatKeywords,
  searchChatsForUser,
  updateChat,
} from "@/lib/db-store";
import { bearerTokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  return bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN);
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const chatId = req.headers.get("x-ai-chat-id")?.trim() || "";
  const userId = req.headers.get("x-ai-chat-user-id")?.trim() || undefined;
  const jobId = req.headers.get("x-ai-chat-job-id")?.trim() || "";
  const chat = chatId ? getChat(chatId, userId) : null;
  if (!chat || !jobId) return Response.json({ error: "Invalid chat context" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = body.action === "search" ? "search" : "update";
  if (action === "search") {
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
    if (!query) return Response.json({ results: [] });
    const requestedLimit = typeof body.limit === "number" ? Math.floor(body.limit) : 10;
    const limit = Math.min(30, Math.max(1, requestedLimit));
    return Response.json({
      results: searchChatsForUser(query, userId, limit),
      actor: "agent",
      jobId,
    });
  }

  const incoming = normalizeChatKeywords(body.keywords);
  if (!incoming.length) return Response.json({ error: "keywords must contain at least one value" }, { status: 400 });
  const mode = body.mode === "replace" ? "replace" : "add";
  const keywords = mode === "replace"
    ? incoming
    : normalizeChatKeywords([...(chat.keywords || []), ...incoming]);
  const updated = updateChat(chatId, { keywords }, userId);
  if (!updated) return Response.json({ error: "Chat not found" }, { status: 404 });
  return Response.json({
    chatId,
    keywords: updated.keywords || [],
    actor: "agent",
    jobId,
  });
}

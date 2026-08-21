import { getAuthenticatedUser, isAuthenticated } from "@/lib/auth";
import { getDatabase } from "@/lib/sqlite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Persisted navigation history for the agent browser (per chat, newest first).
export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await getAuthenticatedUser(req);
  const ownerId = user?.id || user?.username || null;
  if (!ownerId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const chatId = new URL(req.url).searchParams.get("chatId")?.trim();
  if (!chatId) {
    return Response.json({ error: "chatId is required" }, { status: 400 });
  }
  try {
    const rows = getDatabase()
      .prepare("SELECT id, url, title, ts FROM browser_history WHERE owner_id = ? AND chat_id = ? ORDER BY ts DESC LIMIT 200")
      .all(ownerId, chatId);
    return Response.json({ history: rows });
  } catch {
    return Response.json({ history: [] });
  }
}

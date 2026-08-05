import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { requestJobCancel } from "@/lib/db-jobs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { chatId?: string };
  const chatId = body.chatId?.trim();
  if (!chatId) return Response.json({ error: "chatId is required" }, { status: 400 });
  const active = requestJobCancel(chatId, (await getAuthenticatedUserId(req)) ?? undefined);
  if (!active) return Response.json({ error: "No active run" }, { status: 404 });
  return Response.json({ ok: true, status: "cancel-requested" });
}

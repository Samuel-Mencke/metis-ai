import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getChatLogs } from "@/lib/chat-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req) ?? undefined;
  const { id } = await params;
  const logs = getChatLogs(id, ownerId);
  if (!logs) return Response.json({ error: "Chat not found." }, { status: 404 });
  return Response.json({ logs });
}

import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { cloneChatByShareId } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; password?: string };
  try {
    body = (await req.json()) as { id?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const result = cloneChatByShareId(body.id || "", body.password, ownerId);
  if (result.status !== "ok") {
    return Response.json({ error: "This shared chat is unavailable or requires a password." }, { status: 404 });
  }
  return Response.json({ chat: result.chat }, { status: 201 });
}

import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { requestRemoteClient } from "@/lib/remote-client-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await params;
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const info = await requestRemoteClient({
      clientId: id,
      ownerId,
      action: "get_info",
      approved: true,
      source: "user",
      timeoutMs: 15_000,
    });
    return Response.json({ info });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Connection test failed" }, { status: 400 });
  }
}


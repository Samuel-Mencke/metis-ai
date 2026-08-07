import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { submitOAuthManualCode } from "@/lib/oauth-flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    flowId?: unknown;
    code?: unknown;
  };
  if (typeof body.flowId !== "string" || typeof body.code !== "string") {
    return Response.json({ error: "flowId and code are required." }, { status: 400 });
  }
  const flow = submitOAuthManualCode(body.flowId.trim(), ownerId, body.code);
  if (!flow) return Response.json({ error: "OAuth flow not found or code is empty." }, { status: 404 });
  return Response.json({ flow });
}

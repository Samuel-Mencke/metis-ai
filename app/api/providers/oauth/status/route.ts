import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getOAuthFlow } from "@/lib/oauth-flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const flowId = new URL(req.url).searchParams.get("flowId")?.trim();
  if (!flowId) return Response.json({ error: "flowId is required." }, { status: 400 });
  const flow = getOAuthFlow(flowId, ownerId);
  if (!flow) return Response.json({ error: "OAuth flow not found." }, { status: 404 });
  return Response.json({
    flow: {
      ...flow,
      manualInputRequired: flow.status === "awaiting_code",
    },
  });
}

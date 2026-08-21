import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getPlanUsage } from "@/lib/plan-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const snapshot = await getPlanUsage(force, userId);
  return Response.json(snapshot);
}

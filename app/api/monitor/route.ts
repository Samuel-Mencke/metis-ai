import { isAuthenticated } from "@/lib/auth";
import { getServerMetrics } from "@/lib/server-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await getServerMetrics(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Metrics unavailable" }, { status: 503 });
  }
}

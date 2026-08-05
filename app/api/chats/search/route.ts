import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { searchChatsForUser } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() || "";
  if (!query) return Response.json({ results: [] });

  const limitParam = Number(url.searchParams.get("limit") || "30");
  const limit = Number.isFinite(limitParam)
    ? Math.min(50, Math.max(1, Math.floor(limitParam)))
    : 30;

  return Response.json({
    results: searchChatsForUser(
      query.slice(0, 200),
      (await getAuthenticatedUserId(req)) ?? undefined,
      limit,
    ),
  });
}

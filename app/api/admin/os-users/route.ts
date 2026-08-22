import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin, listHostOsUsers } from "@/lib/user-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({
    users: listHostOsUsers().map(({ username, uid, gid, home }) => ({
      username,
      uid,
      gid,
      home,
    })),
  });
}

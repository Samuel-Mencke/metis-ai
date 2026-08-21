import { createAccount } from "@/lib/accounts";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getAuthenticatedUserId(req);
  const adminToken = process.env.ACCOUNT_ADMIN_TOKEN?.trim();
  const tokenOk = Boolean(adminToken && req.headers.get("x-account-admin-token") === adminToken);
  if (!tokenOk && !isHostAdmin(userId)) {
    return Response.json({ error: "Account administration is disabled or unauthorized" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    workspaceRoot?: string;
  };
  const account = body.username && body.password
    ? createAccount(body.username, body.password, body.workspaceRoot)
    : null;
  if (!account) return Response.json({ error: "Invalid or already used username, or password too short" }, { status: 400 });
  return Response.json({ account }, { status: 201 });
}

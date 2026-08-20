import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
import {
  createManagedUser,
  deleteManagedUser,
  listAdminUsers,
} from "@/lib/admin-users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: Request) {
  if (!(await isAuthenticated(req))) {
    return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId: userId! };
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if ("error" in auth && auth.error) return auth.error;
  return Response.json({ users: listAdminUsers() });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if ("error" in auth && auth.error) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    workspaceRoot?: string;
    isAdmin?: boolean;
    osUsername?: string;
  };
  try {
    const user = createManagedUser({
      username: body.username || "",
      password: body.password || "",
      workspaceRoot: body.workspaceRoot,
      isAdmin: body.isAdmin,
      osUsername: body.osUsername,
    });
    return Response.json({ user }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create user.";
    const status = /already taken|Invalid username/i.test(message) ? 400 : 400;
    return Response.json({ error: message }, { status });
  }
}

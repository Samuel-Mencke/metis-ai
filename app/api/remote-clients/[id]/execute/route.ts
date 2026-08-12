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
  const body = (await req.json().catch(() => ({}))) as {
    command?: unknown;
    cwd?: unknown;
    timeout?: unknown;
    approved?: unknown;
  };
  if (typeof body.command !== "string" || !body.command.trim()) {
    return Response.json({ error: "Command is required" }, { status: 400 });
  }
  try {
    const result = await requestRemoteClient({
      clientId: id,
      ownerId,
      action: "execute_command",
      source: "user",
      approved: body.approved === true,
      params: {
        command: body.command,
        ...(typeof body.cwd === "string" ? { cwd: body.cwd } : {}),
        ...(typeof body.timeout === "number" ? { timeout: body.timeout } : {}),
      },
    });
    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Remote command failed" }, { status: 400 });
  }
}


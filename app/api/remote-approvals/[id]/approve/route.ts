import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { approveRemoteApproval } from "@/lib/remote-clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const ownerId = await getAuthenticatedUserId(req);
  const { id } = await params;
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!id || !approveRemoteApproval(id, ownerId)) {
    return Response.json({ error: "Approval request is missing, expired, already used, or belongs to another account" }, { status: 409 });
  }
  return Response.json({ ok: true });
}

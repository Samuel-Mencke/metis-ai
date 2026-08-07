import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  deleteProviderConnection,
  getProviderConnection,
  updateProviderConnection,
} from "@/lib/provider-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function owner(req: Request) {
  if (!(await isAuthenticated(req))) return null;
  return getAuthenticatedUserId(req);
}

export async function GET(req: Request, { params }: Params) {
  const ownerId = await owner(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const connection = getProviderConnection(id, ownerId);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  return Response.json({ connection });
}

export async function PATCH(req: Request, { params }: Params) {
  const ownerId = await owner(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const connection = updateProviderConnection(id, ownerId, {
      ...(typeof body.label === "string" ? { label: body.label } : {}),
      ...(typeof body.baseUrl === "string" ? { baseUrl: body.baseUrl } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
      ...(body.config && typeof body.config === "object" && !Array.isArray(body.config)
        ? { config: body.config as Record<string, unknown> }
        : {}),
      ...(typeof body.secret === "string" ? { secret: body.secret } : {}),
      ...(body.clearSecret === true ? { clearSecret: true } : {}),
    });
    if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
    return Response.json({ connection });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update provider connection." },
      { status: 400 },
    );
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const ownerId = await owner(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!deleteProviderConnection(id, ownerId)) {
    return Response.json({ error: "Connection not found." }, { status: 404 });
  }
  return Response.json({ ok: true });
}

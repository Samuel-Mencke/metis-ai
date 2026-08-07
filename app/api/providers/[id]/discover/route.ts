import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  getProviderConnectionSecret,
  markProviderConnection,
} from "@/lib/provider-connections";
import { refreshProviderModels } from "@/lib/providers/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const { id } = await params;
  const connection = getProviderConnectionSecret(id, ownerId);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  try {
    const models = await refreshProviderModels(connection);
    markProviderConnection(id, ownerId, { ok: true });
    return Response.json({ models });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model discovery failed.";
    markProviderConnection(id, ownerId, { ok: false, error: message });
    return Response.json({ error: message }, { status: 400 });
  }
}

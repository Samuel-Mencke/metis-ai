import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  getProviderConnection,
  upsertProviderConnection,
} from "@/lib/provider-connections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as {
    provider?: unknown;
    endpoint?: unknown;
    apiKey?: unknown;
  };
  const provider = body.provider === "custom" ? "custom" : "openai";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) return Response.json({ error: "API key is required." }, { status: 400 });
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  try {
    const saved = upsertProviderConnection(ownerId, {
      providerKey: "openai",
      slug: `voice-${provider}`,
      label: provider === "custom" ? "Voice custom endpoint" : "Voice OpenAI",
      authType: "api_key",
      ...(endpoint ? { baseUrl: endpoint } : {}),
      config: { purpose: "voice" },
      secret: apiKey,
      enabled: true,
    });
    if (!saved) throw new Error("Could not save voice credentials.");
    return Response.json({
      connectionId: saved.id,
      configured: Boolean(getProviderConnection(saved.id, ownerId)?.hasSecret),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save voice credentials." }, { status: 400 });
  }
}

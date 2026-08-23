import { getVerifiedProviderCapabilities } from "@/lib/providers/registry";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  listChatProviderConnections,
  upsertProviderConnection,
  type ProviderConnectionInput,
} from "@/lib/provider-connections";
import { listProviderDefinitions } from "@/lib/providers/registry";
import type { ProviderAuthType } from "@/lib/providers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicProviders() {
  return listProviderDefinitions().map((provider) => ({
    key: provider.key,
    name: provider.name,
    description: provider.description,
    kind: provider.kind,
    authTypes: provider.authTypes,
    defaultBaseUrl: provider.defaultBaseUrl,
    capabilities: getVerifiedProviderCapabilities(provider.key)?.verified ?? provider.capabilities,
    models: provider.models,
    setupHint: provider.setupHint,
  }));
}

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  return Response.json({
    providers: publicProviders(),
    connections: listChatProviderConnections(ownerId),
  });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const input: ProviderConnectionInput = {
      ...(typeof body.id === "string" ? { id: body.id } : {}),
      providerKey: typeof body.providerKey === "string" ? body.providerKey : "",
      slug: typeof body.slug === "string" ? body.slug : "",
      label: typeof body.label === "string" ? body.label : "",
      authType: body.authType as ProviderAuthType,
      ...(typeof body.baseUrl === "string" ? { baseUrl: body.baseUrl } : {}),
      ...(body.config && typeof body.config === "object" && !Array.isArray(body.config)
        ? { config: body.config as Record<string, unknown> }
        : {}),
      ...(typeof body.secret === "string" ? { secret: body.secret } : {}),
      ...(body.clearSecret === true ? { clearSecret: true } : {}),
      ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    };
    const connection = upsertProviderConnection(ownerId, input);
    return Response.json({ connection }, { status: input.id ? 200 : 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to save provider connection." },
      { status: 400 },
    );
  }
}

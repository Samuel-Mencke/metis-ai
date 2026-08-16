import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { checkGatewayHealth } from "@/lib/mcp";
import { listProviderConnections } from "@/lib/provider-connections";
import { getUserAgentCwd } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authed = await isAuthenticated(req);
  const gateway = await checkGatewayHealth();
  const ownerId = await getAuthenticatedUserId(req);
  const connections = ownerId ? listProviderConnections(ownerId) : [];
  const hasCursorSdkConnection = connections.some(
    (connection) => connection.providerKey === "cursor" && connection.enabled && connection.hasSecret,
  );

  return Response.json({
    authenticated: authed,
    agentCwd: ownerId ? getUserAgentCwd(ownerId) : undefined,
    cursorSdkConfigured: hasCursorSdkConnection,
    providers: connections.map((connection) => ({
      id: connection.id,
      providerKey: connection.providerKey,
      label: connection.label,
      enabled: connection.enabled,
      hasSecret: connection.hasSecret,
      lastError: connection.lastError,
    })),
    mcp: gateway,
  });
}

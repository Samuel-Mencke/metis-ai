import { collectRemoteClientEvents, requestRemoteClient } from "@/lib/remote-client-gateway";
import { listRemoteClients } from "@/lib/remote-clients";
import { bearerTokenMatches } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = req.headers.get("x-ai-chat-user-id")?.trim() || "";
  if (!ownerId) return Response.json({ error: "Account context is required" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    clientId?: unknown;
    action?: unknown;
    params?: unknown;
    approved?: unknown;
    source?: unknown;
  };
  if (typeof body.clientId !== "string" || typeof body.action !== "string") {
    return Response.json({ error: "clientId and action are required" }, { status: 400 });
  }
  try {
    const result = await requestRemoteClient({
      clientId: body.clientId,
      ownerId,
      action: body.action as Parameters<typeof requestRemoteClient>[0]["action"],
      params: body.params && typeof body.params === "object" && !Array.isArray(body.params)
        ? body.params as Record<string, unknown>
        : {},
      approved: body.approved === true,
      source: body.source === "agent" ? "agent" : "user",
    });
    const events = body.action === "pty_input" && body.params && typeof body.params === "object" &&
      typeof (body.params as Record<string, unknown>).sessionId === "string"
      ? await collectRemoteClientEvents(String((body.params as Record<string, unknown>).sessionId))
      : undefined;
    return Response.json({ result, ...(events ? { events } : {}) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Remote client request failed" }, { status: 400 });
  }
}

export async function GET(req: Request) {
  if (!bearerTokenMatches(req, process.env.MCP_BEARER_TOKEN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const ownerId = req.headers.get("x-ai-chat-user-id")?.trim() || "";
  if (!ownerId) return Response.json({ error: "Account context is required" }, { status: 400 });
  return Response.json({ clients: listRemoteClients(ownerId) });
}


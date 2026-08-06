import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function gatewayTool(req: Request, name: string, args: Record<string, unknown>) {
  // @ts-expect-error The shared gateway core is an ESM runtime module.
  const { dispatchGatewayTool } = await import("@/packages/mcp-gateway/index.mjs");
  const result = (await dispatchGatewayTool(name, args, {
    context: { userId: (await getAuthenticatedUserId(req)) ?? undefined },
  })) as {
    content?: Array<{ text?: string }>;
    isError?: boolean;
  };
  const text = result.content?.map((item) => item.text || "").join("\n") || "";
  if (result.isError) throw new Error(text || "MCP operation failed");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("MCP operation returned invalid JSON");
  }
}

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    const result = await gatewayTool(req, "set_mcp_server_enabled", { server: id, enabled: body.enabled });
    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update MCP server" }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    // removeMcpServer changes only the local registry and closes a cached child.
    // @ts-expect-error The shared gateway core is an ESM runtime module.
    const { removeMcpServer } = await import("@/packages/mcp-gateway/index.mjs");
    if (!(await removeMcpServer(id, { userId: (await getAuthenticatedUserId(req)) ?? undefined }))) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete MCP server" }, { status: 400 });
  }
}

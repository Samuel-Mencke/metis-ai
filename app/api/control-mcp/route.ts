import { timingSafeEqual } from "node:crypto";
import { controlToolDefinitions, executeControlTool, resolveControlOwnerId } from "@/lib/control-mcp-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tokenMatches(req: Request) {
  const expected = process.env.CONTROL_MCP_BEARER_TOKEN?.trim() || process.env.MCP_BEARER_TOKEN?.trim() || "";
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const actual = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function jsonRpc(id: unknown, result: unknown, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function rpcError(id: unknown, code: number, message: string, status = 400) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

export async function POST(req: Request) {
  if (!tokenMatches(req)) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="Metis Control MCP"', "Cache-Control": "no-store" },
    });
  }
  const body = await req.json().catch(() => null) as Record<string, any> | null;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(body?.id, -32600, "Invalid Request");
  }
  const { id, method } = body;
  if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
  if (method === "initialize") {
    return jsonRpc(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "metis-persistent-control", version: "1.0.0" },
      instructions: "Durable control plane for Metis remote clients and Antigravity. control_start can continue after this MCP connection closes. Use control_inbox in a later connection to fetch missed results and artifacts.",
    });
  }
  if (method === "ping") return jsonRpc(id, {});
  if (method === "tools/list") return jsonRpc(id, { tools: controlToolDefinitions });
  if (method === "tools/call") {
    const name = body.params?.name;
    if (typeof name !== "string") return rpcError(id, -32602, "Tool name is required");
    const args = body.params?.arguments && typeof body.params.arguments === "object" ? body.params.arguments : {};
    const result = await executeControlTool(resolveControlOwnerId(), name, args);
    return jsonRpc(id, result);
  }
  return rpcError(id, -32601, `Method not found: ${method}`);
}

export async function GET() {
  return new Response("Metis Control MCP uses authenticated Streamable HTTP POST requests.", {
    status: 405,
    headers: { Allow: "POST, OPTIONS", "Cache-Control": "no-store" },
  });
}

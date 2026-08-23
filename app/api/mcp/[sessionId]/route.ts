import { NextRequest, NextResponse } from "next/server";
import { getMcpSession, handleMcpToolCall, METIS_MCP_TOOLS } from "@/lib/runtime/mcp-gateway";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = getMcpSession(sessionId);

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader && !authHeader.includes(session.token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, method, params: rpcParams } = body;

    if (method === "initialize") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: "metis-mcp-gateway",
            version: "1.0.0",
          },
        },
      });
    }

    if (method === "tools/list") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: {
          tools: METIS_MCP_TOOLS,
        },
      });
    }

    if (method === "tools/call") {
      const toolName = rpcParams?.name;
      const toolArgs = (rpcParams?.arguments as Record<string, unknown>) || {};
      const toolResult = await handleMcpToolCall({
        sessionId,
        name: toolName,
        args: toolArgs,
      });

      return NextResponse.json({
        jsonrpc: "2.0",
        id,
        result: toolResult,
      });
    }

    if (method?.startsWith("notifications/")) {
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method ${method} not found`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: err?.message || "Internal error",
      },
    }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const session = getMcpSession(sessionId);
  if (!session) {
    return NextResponse.json({ status: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    status: "active",
    sessionId: session.sessionId,
    cwd: session.cwd,
    tools: METIS_MCP_TOOLS.map((t) => t.name),
  });
}

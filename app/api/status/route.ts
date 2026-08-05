import { isAuthenticated } from "@/lib/auth";
import { checkGatewayHealth } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authed = await isAuthenticated(req);
  const gateway = await checkGatewayHealth();
  const hasApiKey = Boolean(process.env.CURSOR_API_KEY?.trim());

  return Response.json({
    authenticated: authed,
    cursorApiKey: hasApiKey,
    mcp: gateway,
  });
}

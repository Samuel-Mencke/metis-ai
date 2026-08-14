import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { compress, type CompressionMode } from "@/lib/compression";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = await getAuthenticatedUserId(req);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({})) as { text?: unknown; mode?: unknown };
  const text = typeof body.text === "string" ? body.text.slice(0, 100_000) : "";
  const modes = new Set<CompressionMode>(["lite", "standard", "aggressive", "ultra", "rtk", "stacked"]);
  const mode = typeof body.mode === "string" && modes.has(body.mode as CompressionMode)
    ? body.mode as CompressionMode
    : "stacked";
  const result = compress(text, mode);
  return Response.json({
    mode: result.mode,
    inputChars: result.inputChars,
    outputChars: result.outputChars,
    removedChars: result.removedChars,
    savingsPercent: result.inputChars ? Math.round((result.removedChars / result.inputChars) * 100) : 0,
    text: result.text,
  });
}

import { getChatByShareId } from "@/lib/db-store";
import { consumeRateLimit, requestClientAddress, resetRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestId(req: Request) {
  const url = new URL(req.url);
  return url.searchParams.get("id") || "";
}

export async function GET(req: Request) {
  const result = getChatByShareId(requestId(req));
  if (result.status === "not_found") return Response.json({ error: "Share not found" }, { status: 404 });
  if (result.status === "password_required") {
    return Response.json({ error: "Password required", share: result.share }, { status: 401 });
  }
  return Response.json({ chat: result.chat });
}

export async function POST(req: Request) {
  let body: { id?: string; password?: string };
  try {
    body = (await req.json()) as { id?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rateLimitKey = `share:${requestClientAddress(req)}:${body.id || ""}`;
  const rateLimit = consumeRateLimit(rateLimitKey, 10, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many password attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  const result = getChatByShareId(body.id || "", body.password);
  if (result.status === "not_found") return Response.json({ error: "Share not found" }, { status: 404 });
  if (result.status === "password_required") {
    return Response.json({ error: "Incorrect password", share: result.share }, { status: 401 });
  }
  resetRateLimit(rateLimitKey);
  return Response.json({ chat: result.chat });
}

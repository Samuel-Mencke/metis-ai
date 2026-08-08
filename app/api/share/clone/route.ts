import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { cloneChatByShareId } from "@/lib/db-store";
import { consumeRateLimit, requestClientAddress, resetRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; password?: string };
  try {
    body = (await req.json()) as { id?: string; password?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ownerId = await getAuthenticatedUserId(req);
  if (!ownerId) return Response.json({ error: "A user session is required." }, { status: 401 });
  const rateLimitKey = `share-clone:${requestClientAddress(req)}:${body.id || ""}`;
  const rateLimit = consumeRateLimit(rateLimitKey, 10, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: "Too many password attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }
  const result = cloneChatByShareId(body.id || "", body.password, ownerId);
  if (result.status !== "ok") {
    return Response.json({ error: "This shared chat is unavailable or requires a password." }, { status: 404 });
  }
  resetRateLimit(rateLimitKey);
  return Response.json({ chat: result.chat }, { status: 201 });
}

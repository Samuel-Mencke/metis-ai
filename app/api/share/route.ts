import { getChatByShareId } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requestData(req: Request) {
  const url = new URL(req.url);
  return {
    id: url.searchParams.get("id") || "",
    password: url.searchParams.get("password") || undefined,
  };
}

export async function GET(req: Request) {
  const { id, password } = requestData(req);
  const result = getChatByShareId(id, password);
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
  const result = getChatByShareId(body.id || "", body.password);
  if (result.status === "not_found") return Response.json({ error: "Share not found" }, { status: 404 });
  if (result.status === "password_required") {
    return Response.json({ error: "Incorrect password", share: result.share }, { status: 401 });
  }
  return Response.json({ chat: result.chat });
}

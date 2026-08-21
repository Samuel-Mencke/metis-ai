import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { resetMetisData } from "@/lib/metis-reset";
import { isHostAdmin } from "@/lib/user-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) {
    return Response.json({ error: "Only host administrators can reset Metis." }, { status: 403 });
  }
  try {
    const result = resetMetisData();
    const response = new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
    response.headers.append("Set-Cookie", "ai_chat_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    return response;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Metis reset failed." },
      { status: 500 },
    );
  }
}

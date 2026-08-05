import { isAuthenticated } from "@/lib/auth";
import { deleteMemory, updateMemory } from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  let body: { content?: string; tags?: string[] };
  try {
    body = (await req.json()) as { content?: string; tags?: string[] };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const memory = updateMemory(id, body);
  if (!memory) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ memory });
}

export async function DELETE(req: Request, { params }: Params) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!deleteMemory(id)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}

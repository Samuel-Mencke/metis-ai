import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { clearProjectLogo, getProject, readProjectLogo, setProjectLogo } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
 if (!(await isAuthenticated(req))) return new Response("Unauthorized", { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const { id } = await params;
 if (!getProject(id, ownerId)) return new Response("Not found", { status: 404 });
 const logo = readProjectLogo(id, ownerId);
 if (!logo) return new Response("Not found", { status: 404 });
 return new Response(new Uint8Array(logo.buf), {
  headers: {
   "Content-Type": logo.mimeType,
   "Cache-Control": "private, max-age=60",
  },
 });
}

export async function POST(req: Request, { params }: Params) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const { id } = await params;
 if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
 const body = (await req.json().catch(() => ({}))) as { data?: string; mimeType?: string };
 if (!body.data) return Response.json({ error: "data is required" }, { status: 400 });
 try {
  const project = setProjectLogo(id, { data: body.data, mimeType: body.mimeType }, ownerId);
  return Response.json({ project });
 } catch (error) {
  return Response.json({ error: error instanceof Error ? error.message : "Could not save logo" }, { status: 400 });
 }
}

export async function DELETE(req: Request, { params }: Params) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const { id } = await params;
 const project = clearProjectLogo(id, ownerId);
 if (!project) return Response.json({ error: "Not found" }, { status: 404 });
 return Response.json({ project });
}

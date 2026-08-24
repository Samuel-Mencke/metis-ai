import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { addProjectFile, getProject, listProjectFiles } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const { id } = await params;
 if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
 return Response.json({ files: listProjectFiles(id, ownerId) });
}

export async function POST(req: Request, { params }: Params) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const { id } = await params;
 if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
 const body = (await req.json().catch(() => ({}))) as {
  name?: string;
  mimeType?: string;
  text?: string;
  data?: string;
 };
 if (!body.name?.trim()) return Response.json({ error: "name is required" }, { status: 400 });
 try {
  const file = addProjectFile({
   projectId: id,
   ownerId,
   name: body.name,
   mimeType: body.mimeType,
   text: body.text,
   data: body.data,
  });
  return Response.json({ file }, { status: 201 });
 } catch (error) {
  return Response.json({ error: error instanceof Error ? error.message : "Could not add file" }, { status: 400 });
 }
}

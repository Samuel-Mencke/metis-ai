import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { deleteProjectFile, getProject, readProjectFileBytes } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(req: Request, { params }: Params) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const { id, fileId } = await params;
 if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
 const stored = readProjectFileBytes(id, fileId, ownerId);
 if (!stored) return Response.json({ error: "Not found" }, { status: 404 });
 const inline = stored.file.mimeType.startsWith("image/") || stored.file.mimeType === "application/pdf";
 return new Response(new Uint8Array(stored.buf), {
  headers: {
   "Content-Type": stored.file.mimeType || "application/octet-stream",
   "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${stored.file.name.replace(/"/g, "")}"`,
   "Cache-Control": "private, max-age=60",
  },
 });
}

export async function DELETE(req: Request, { params }: Params) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const { id, fileId } = await params;
 if (!getProject(id, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
 if (!deleteProjectFile(id, fileId, ownerId)) return Response.json({ error: "Not found" }, { status: 404 });
 return Response.json({ ok: true });
}

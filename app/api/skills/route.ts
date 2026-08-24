import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { getGlobalModelSettings, saveGlobalModelSettings } from "@/lib/db-store";
import { addManualSkill, enabledSkills, listInstalledSkills, readSkillMarkdown, skillEnabled } from "@/lib/skills";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function responseSkills(ownerId?: string) {
 const settings = getGlobalModelSettings(ownerId);
 return {
 skills: listInstalledSkills().map((skill) => ({ ...skill, enabled: skillEnabled(skill.id, settings) })),
 enabled: enabledSkills(settings).map((skill) => skill.id),
 };
}

export async function GET(req: Request) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const readId = new URL(req.url).searchParams.get("read")?.trim();
 if (readId) {
 const content = readSkillMarkdown(readId);
 if (content === null) return Response.json({ error: "Skill file not found" }, { status: 404 });
 return Response.json({ id: readId, content });
 }
 return Response.json(responseSkills(ownerId));
}

export async function POST(req: Request) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 try {
 let id = "";
 let content = "";
 if (req.headers.get("content-type")?.includes("multipart/form-data")) {
 const form = await req.formData();
 id = String(form.get("id") || "");
 const file = form.get("file");
 if (file instanceof File) {
 content = await file.text();
 if (!id) id = file.name.replace(/\.md$/i, "");
 }
 } else {
 const body = (await req.json()) as { id?: string; content?: string };
 id = body.id || "";
 content = body.content || "";
 }
 const skill = addManualSkill(id, content);
 return Response.json({ skill, ...responseSkills((await getAuthenticatedUserId(req)) ?? undefined) }, { status: 201 });
 } catch (cause) {
 const message = cause instanceof Error ? cause.message : "Could not add skill.";
 return Response.json({ error: message }, { status: 400 });
 }
}

export async function PATCH(req: Request) {
 if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
 const ownerId = (await getAuthenticatedUserId(req)) ?? undefined;
 const body = (await req.json().catch(() => ({}))) as { enabledSkills?: Record<string, boolean> };
 const current = getGlobalModelSettings(ownerId);
 const enabledSkillsNext = {
 ...(current.enabledSkills || {}),
 ...(body.enabledSkills && typeof body.enabledSkills === "object" ? body.enabledSkills : {}),
 };
 const settings = saveGlobalModelSettings({ ...current, enabledSkills: enabledSkillsNext }, ownerId);
 return Response.json({
 skills: listInstalledSkills().map((skill) => ({ ...skill, enabled: skillEnabled(skill.id, settings) })),
 });
}

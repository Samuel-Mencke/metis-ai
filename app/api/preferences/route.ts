import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  getGlobalModelSettings,
  saveGlobalModelSettings,
} from "@/lib/db-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ settings: getGlobalModelSettings((await getAuthenticatedUserId(req)) ?? undefined) });
}

export async function PATCH(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    modelId?: unknown;
    modelParams?: unknown;
    subagentModelEnabled?: unknown;
    subagentModelId?: unknown;
  };
  const userId = (await getAuthenticatedUserId(req)) ?? undefined;
  const current = getGlobalModelSettings(userId);
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : undefined;
  const modelParams = Array.isArray(body.modelParams)
    ? body.modelParams.filter(
        (item): item is { id: string; value: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as { id?: unknown }).id === "string" &&
          typeof (item as { value?: unknown }).value === "string",
      )
    : undefined;
  const subagentModelId =
    typeof body.subagentModelId === "string" ? body.subagentModelId.trim() : undefined;
  const subagentModelEnabled =
    typeof body.subagentModelEnabled === "boolean" ? body.subagentModelEnabled : undefined;
  return Response.json({
    settings: saveGlobalModelSettings(
      {
        ...current,
        ...(modelId !== undefined ? { modelId } : {}),
        ...(modelParams !== undefined ? { modelParams } : {}),
        ...(subagentModelId !== undefined ? { subagentModelId } : {}),
        ...(subagentModelEnabled !== undefined ? { subagentModelEnabled } : {}),
      },
      userId,
    ),
  });
}

import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import {
  getGlobalModelSettings,
  saveGlobalModelSettings,
  type GlobalModelSettings,
} from "@/lib/db-store";
import { normalizeVoiceSettings } from "@/lib/shared-context";

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
    modelParamsByModel?: unknown;
    subagentModelEnabled?: unknown;
    subagentModelId?: unknown;
    draftInput?: unknown;
    pinnedNoteIds?: unknown;
    favoriteModelKeys?: unknown;
    modelAliases?: unknown;
    browserRealtime?: unknown;
    browserFps?: unknown;
    browserViewportWidth?: unknown;
    browserViewportHeight?: unknown;
    voiceInput?: unknown;
    featureFlags?: unknown;
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
  const modelParamsByModel =
    body.modelParamsByModel &&
    typeof body.modelParamsByModel === "object" &&
    !Array.isArray(body.modelParamsByModel)
      ? Object.fromEntries(
          Object.entries(body.modelParamsByModel)
            .slice(0, 200)
            .map(([key, value]) => [
              key.trim().slice(0, 500),
              Array.isArray(value)
                ? value
                    .filter(
                      (item): item is { id: string; value: string } =>
                        Boolean(item) &&
                        typeof item === "object" &&
                        typeof (item as { id?: unknown }).id === "string" &&
                        typeof (item as { value?: unknown }).value === "string",
                    )
                    .slice(0, 50)
                : [],
            ])
            .filter(([key]) => Boolean(key)),
        )
      : undefined;
  const subagentModelId =
    typeof body.subagentModelId === "string" ? body.subagentModelId.trim() : undefined;
  const subagentModelEnabled =
    typeof body.subagentModelEnabled === "boolean" ? body.subagentModelEnabled : undefined;
  const draftInput =
    typeof body.draftInput === "string" ? body.draftInput.slice(0, 100_000) : undefined;
  const pinnedNoteIds = Array.isArray(body.pinnedNoteIds)
    ? body.pinnedNoteIds
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim().slice(0, 120))
        .slice(0, 20)
    : undefined;
  const favoriteModelKeys = Array.isArray(body.favoriteModelKeys)
    ? body.favoriteModelKeys
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim().slice(0, 300))
        .slice(0, 100)
    : undefined;
  const modelAliases = body.modelAliases && typeof body.modelAliases === "object" && !Array.isArray(body.modelAliases)
    ? Object.fromEntries(
        Object.entries(body.modelAliases)
          .filter((entry): entry is [string, string] =>
            typeof entry[0] === "string" &&
            typeof entry[1] === "string" &&
            entry[0].trim().length > 0 &&
            entry[1].trim().length > 0,
          )
          .slice(0, 100)
          .map(([key, value]) => [key.trim().slice(0, 300), value.trim().slice(0, 120)]),
      )
    : undefined;
  const browserRealtime =
    typeof body.browserRealtime === "boolean" ? body.browserRealtime : undefined;
  const browserFps =
    typeof body.browserFps === "number" && Number.isFinite(body.browserFps)
      ? Math.max(1, Math.min(30, Math.round(body.browserFps)))
      : undefined;
  const browserViewportWidth =
    typeof body.browserViewportWidth === "number" && Number.isFinite(body.browserViewportWidth)
      ? Math.max(320, Math.min(2560, Math.round(body.browserViewportWidth)))
      : undefined;
  const browserViewportHeight =
    typeof body.browserViewportHeight === "number" && Number.isFinite(body.browserViewportHeight)
      ? Math.max(240, Math.min(1600, Math.round(body.browserViewportHeight)))
      : undefined;
  const voiceInput =
    body.voiceInput && typeof body.voiceInput === "object" && !Array.isArray(body.voiceInput)
      ? normalizeVoiceSettings(body.voiceInput as GlobalModelSettings["voiceInput"])
      : undefined;
  const featureFlags =
    body.featureFlags && typeof body.featureFlags === "object" && !Array.isArray(body.featureFlags)
      ? Object.fromEntries(
          Object.entries(body.featureFlags)
            .filter(([key, value]) => ["plans", "notes", "recovery", "askUserTimeout", "voiceInput"].includes(key) && typeof value === "boolean"),
        )
      : undefined;
  return Response.json({
    settings: saveGlobalModelSettings(
      {
        ...current,
        ...(modelId !== undefined ? { modelId } : {}),
        ...(modelParams !== undefined ? { modelParams } : {}),
        ...(modelParamsByModel !== undefined ? { modelParamsByModel } : {}),
        ...(subagentModelId !== undefined ? { subagentModelId } : {}),
        ...(subagentModelEnabled !== undefined ? { subagentModelEnabled } : {}),
        ...(draftInput !== undefined ? { draftInput } : {}),
        ...(pinnedNoteIds !== undefined ? { pinnedNoteIds } : {}),
        ...(favoriteModelKeys !== undefined ? { favoriteModelKeys } : {}),
        ...(modelAliases !== undefined ? { modelAliases } : {}),
        ...(browserRealtime !== undefined ? { browserRealtime } : {}),
        ...(browserFps !== undefined ? { browserFps } : {}),
        ...(browserViewportWidth !== undefined ? { browserViewportWidth } : {}),
        ...(browserViewportHeight !== undefined ? { browserViewportHeight } : {}),
        ...(voiceInput !== undefined ? { voiceInput } : {}),
        ...(featureFlags !== undefined ? { featureFlags } : {}),
      },
      userId,
    ),
  });
}

import { Cursor } from "@cursor/sdk";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { filterAllowedModels } from "@/lib/model-access";
import { UNCENSORED_PARAMETER } from "@/lib/model-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ModelParamValue = {
  value: string;
  displayName?: string;
};

export type ModelParameter = {
  id: string;
  displayName?: string;
  values: ModelParamValue[];
};

export type ModelParamSelection = {
  id: string;
  value: string;
};

export type ModelInfo = {
  id: string;
  displayName: string;
  description?: string;
  parameters?: ModelParameter[];
  defaultParams?: ModelParamSelection[];
};

const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "composer-2.5",
    displayName: "Composer 2.5",
    parameters: [
      {
        id: "fast",
        displayName: "Fast",
        values: [
          { value: "false" },
          { value: "true", displayName: "Fast" },
        ],
      },
      UNCENSORED_PARAMETER,
    ],
    defaultParams: [{ id: "fast", value: "true" }],
  },
  {
    id: "default",
    displayName: "Auto",
    parameters: [UNCENSORED_PARAMETER],
    defaultParams: [],
  },
];

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getAuthenticatedUserId(req);

  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    const allowedModels = filterAllowedModels(userId ?? undefined, FALLBACK_MODELS);
    return Response.json({
      models: allowedModels,
      defaultModelId: allowedModels.some((model) => model.id === "composer-2.5")
        ? "composer-2.5"
        : allowedModels[0]?.id || "",
      source: "fallback",
    });
  }

  try {
    const listed = await Cursor.models.list({ apiKey });
    const models: ModelInfo[] = listed.map((m) => {
      const defaultVariant =
        m.variants?.find((v) => v.isDefault) ?? m.variants?.[0];
      const cursorParams = (m.parameters ?? []).map((p) => ({
        id: p.id,
        displayName: p.displayName,
        values: p.values.map((v) => ({
          value: v.value,
          displayName: v.displayName,
        })),
      }));
      // Ensure every model exposes the uncensored toggle, deduped by id.
      const hasUncensored = cursorParams.some((p) => p.id === "uncensored");
      const parameters = hasUncensored
        ? cursorParams
        : [...cursorParams, UNCENSORED_PARAMETER];
      return {
        id: m.id,
        displayName: m.displayName || m.id,
        description: m.description,
        parameters,
        defaultParams: (defaultVariant?.params ?? [])
          .filter((p) => p.id !== "cyber")
          .map((p) => ({ id: p.id, value: p.value })),
      };
    });
    const allowedModels = filterAllowedModels(userId ?? undefined, models);
    return Response.json({
      models: allowedModels,
      defaultModelId: allowedModels.some((model) => model.id === "composer-2.5")
        ? "composer-2.5"
        : allowedModels[0]?.id || "",
      source: "cursor",
    });
  } catch (err) {
    const allowedModels = filterAllowedModels(userId ?? undefined, FALLBACK_MODELS);
    return Response.json({
      models: allowedModels,
      defaultModelId: allowedModels.some((model) => model.id === "composer-2.5")
        ? "composer-2.5"
        : allowedModels[0]?.id || "",
      source: "fallback",
      error: err instanceof Error ? err.message : "Failed to list models",
    });
  }
}

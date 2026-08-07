import { Cursor } from "@cursor/sdk";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { filterAllowedModels } from "@/lib/model-access";
import { UNCENSORED_PARAMETER } from "@/lib/model-params";
import {
  findActiveConnection,
  getProviderConnectionSecret,
  listProviderConnections,
} from "@/lib/provider-connections";
import { providerModelsForConnection } from "@/lib/providers/discovery";
import { modelKey } from "@/lib/providers/types";

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
  providerId?: string;
  providerName?: string;
  connectionId?: string;
  connectionLabel?: string;
  source?: "cursor" | "catalog" | "discovered";
  tags?: string[];
  capabilities?: Record<string, boolean>;
  parameters?: ModelParameter[];
  defaultParams?: ModelParamSelection[];
};

export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getAuthenticatedUserId(req);

  const cursorConnection = userId ? findActiveConnection(userId, "cursor") : null;
  let cursorCredential: string | undefined;
  try {
    cursorCredential = cursorConnection && userId
      ? getProviderConnectionSecret(cursorConnection.id, userId)?.secret
      : undefined;
  } catch {
    cursorCredential = undefined;
  }
  const apiKey = cursorCredential;
  let cursorModels: ModelInfo[] = [];
  let cursorSource: "cursor" | "none" = "none";
  let error: string | undefined;

  if (apiKey) {
    try {
      const listed = await Cursor.models.list({ apiKey });
      cursorModels = listed.map((m) => {
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
        const hasUncensored = cursorParams.some((p) => p.id === "uncensored");
        return {
          id: m.id,
          displayName: m.displayName || m.id,
          providerId: "cursor",
          providerName: "Cursor",
          source: "cursor",
          description: m.description,
          parameters: hasUncensored
            ? cursorParams
            : [...cursorParams, UNCENSORED_PARAMETER],
          defaultParams: (defaultVariant?.params ?? [])
            .filter((p) => p.id !== "cyber")
            .map((p) => ({ id: p.id, value: p.value })),
        };
      });
      cursorSource = "cursor";
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to list Cursor models";
    }
  }

  const connections = userId ? listProviderConnections(userId, false) : [];
  const connectionModels: ModelInfo[] = [];
  for (const connection of connections) {
    if (connection.providerKey === "cursor") continue;
    const models = providerModelsForConnection({ ...connection });
    connectionModels.push(
      ...models.map((model) => ({
        id: model.key || modelKey(model.providerKey, model.id),
        displayName: model.displayName,
        description: model.description,
        providerId: model.providerKey,
        providerName: model.providerName,
        connectionId: model.connectionId,
        connectionLabel: model.connectionLabel,
        source: model.source,
        tags: "tags" in model && Array.isArray(model.tags) ? model.tags : undefined,
        capabilities: model.capabilities as Record<string, boolean> | undefined,
        parameters: model.parameters?.map((parameter) => ({
          id: parameter.id,
          displayName: parameter.displayName,
          values: parameter.values.map((value) => ({ ...value })),
        })),
        defaultParams: model.defaultParams?.map((parameter) => ({ ...parameter })),
      })),
    );
  }

  const allModels = [...cursorModels, ...connectionModels];
  const allowedModels = filterAllowedModels(userId ?? undefined, allModels);
  return Response.json({
    models: allowedModels,
    defaultModelId: allowedModels[0]?.id || "",
    source: cursorSource,
    providers: connections.map((connection) => ({
      id: connection.id,
      providerKey: connection.providerKey,
      label: connection.label,
      enabled: connection.enabled,
    })),
    ...(error ? { error } : {}),
  });
}

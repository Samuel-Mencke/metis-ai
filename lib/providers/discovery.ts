import { Cursor } from "@cursor/sdk";
import {
  listProviderModels,
  saveProviderModels,
  type ProviderConnectionWithSecret,
} from "@/lib/provider-connections";
import { getProviderDefinition, getProviderModelDefinition, getVerifiedProviderCapabilities } from "@/lib/providers/registry";
import { contextWindowOf, inferContextWindow } from "@/lib/context-window";
import {
  modelKey,
  type ProviderModel,
  type ProviderModelDefinition,
} from "@/lib/providers/types";

export function normalizeBaseUrl(baseUrl: string | undefined) {
  if (!baseUrl?.trim()) return undefined;
  const parsed = new URL(baseUrl.trim());
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+(?=$)/, "");
  return parsed.toString().replace(/\/+$/, "");
}

function modelEndpoints(baseUrl: string | undefined) {
  const clean = normalizeBaseUrl(baseUrl);
  if (!clean) return [];
  const candidates = clean.endsWith("/v1")
    ? [`${clean}/models`]
    : [`${clean}/models`, `${clean}/v1/models`];
  return [...new Set(candidates)];
}

function authHeaders(providerKey: string, secret?: string): Record<string, string> {
  if (!secret) return {};
  if (providerKey === "anthropic") {
    return {
      "x-api-key": secret,
      "anthropic-version": "2023-06-01",
    };
  }
  if (providerKey === "google") {
    return { "x-goog-api-key": secret };
  }
  return { Authorization: `Bearer ${secret}` };
}

function authHeaderVariants(providerKey: string, secret?: string) {
  if (!secret?.trim()) return [{}];
  const preferred = authHeaders(providerKey, secret.trim());
  return [
    preferred,
    { Authorization: `Bearer ${secret.trim()}` },
    { "x-api-key": secret.trim() },
    { "api-key": secret.trim() },
  ].filter((headers, index, all) =>
    index === all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(headers)),
  );
}

export type CodexOAuthCredentials = {
  access: string;
  refresh: string;
  idToken: string;
  accountId: string;
  expires: number;
};

export function readCodexOAuthCredentials(
  secret: string,
  options: { allowExpired?: boolean } = {},
): CodexOAuthCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new Error("Codex OAuth credentials are not valid JSON.");
  }
  const root = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const raw = root["openai-codex"];
  const record = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const access = typeof record.access === "string" ? record.access.trim() : "";
  const refresh = typeof record.refresh === "string" ? record.refresh.trim() : "";
  const idToken = typeof record.idToken === "string"
    ? record.idToken.trim()
    : typeof record.id_token === "string"
      ? record.id_token.trim()
      : "";
  const accountId = typeof record.accountId === "string"
    ? record.accountId.trim()
    : typeof record.account_id === "string"
      ? record.account_id.trim()
      : "";
  const rawExpiry = record.expires ?? record.expiresAt;
  const expiryNumber = typeof rawExpiry === "number" ? rawExpiry : Number(rawExpiry);
  const expires = Number.isFinite(expiryNumber) && expiryNumber > 0
    ? (expiryNumber < 1e12 ? expiryNumber * 1_000 : expiryNumber)
    : 0;
  if (!access || !refresh || !idToken || !accountId || !expires) {
    throw new Error(
      "Codex OAuth credentials require access, refresh, idToken, accountId, and expiry.",
    );
  }
  if (!options.allowExpired && expires <= Date.now()) {
    throw new Error("Codex OAuth access credentials have expired.");
  }
  return { access, refresh, idToken, accountId, expires };
}

type DiscoveredModel = {
  id: string;
  displayName: string;
  description?: string;
  contextWindow?: number;
  contextWindowDiscovered?: boolean;
  capabilities?: ProviderModel["capabilities"];
  parameters?: ProviderModelDefinition["parameters"];
  defaultParams?: ProviderModelDefinition["defaultParams"];
  tags?: string[];
};

export const NON_CHAT_TOOL_MODEL = /(\bembed|whisper|tts|dall-e|dalle|sora|moderation|babbage|davinci-002|realtime|transcribe|chatgpt-image|gpt-image|gpt-audio|omni-moderation)/i;

export function modelSupportsChatTools(id: string, displayName = "") {
  const hay = `${id} ${displayName}`;
  if (NON_CHAT_TOOL_MODEL.test(hay)) return false;
  if (/\binstruct\b/i.test(hay)) return false;
  return true;
}

export function parseDiscoveredModel(value: unknown): DiscoveredModel | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === "string"
    ? item.id
    : typeof item.slug === "string"
      ? item.slug
      : typeof item.model === "string"
        ? item.model
    : typeof item.name === "string"
      ? item.name.replace(/^models\//, "")
      : "";
  if (!id) return null;
  const displayName =
    typeof item.display_name === "string"
      ? item.display_name
      : typeof item.displayName === "string"
        ? item.displayName
        : id;
  const contextWindow = contextWindowOf(item);
  const capabilities = item.capabilities && typeof item.capabilities === "object"
    ? item.capabilities as ProviderModel["capabilities"]
    : undefined;
  const parameters = Array.isArray(item.parameters)
    ? item.parameters as ProviderModelDefinition["parameters"]
    : undefined;
  const defaultParams = Array.isArray(item.defaultParams)
    ? item.defaultParams as ProviderModelDefinition["defaultParams"]
    : undefined;
  return {
    id,
    displayName,
    ...(typeof item.description === "string" ? { description: item.description } : {}),
    ...(contextWindow ? { contextWindow, contextWindowDiscovered: true } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(parameters ? { parameters } : {}),
    ...(defaultParams ? { defaultParams } : {}),
    ...(Array.isArray(item.tags) ? { tags: item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 32) } : {}),
  };
}

export function mergeDiscoveredContextWindow(options: {
  discovered?: number;
  stored?: number;
  catalog?: number;
}): number | undefined {
  const valid = (value: unknown) =>
 typeof value === "number" && Number.isFinite(value) && value >= 1_024
 ? Math.round(value)
 : undefined;
 return valid(options.discovered) ?? valid(options.catalog) ?? valid(options.stored);
}

async function fetchJson(url: string, headers: Record<string, string>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
    });
    const body = await response.text();
    let parsed: unknown = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }
    if (!response.ok) {
      const detail = parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error?: unknown }).error)
        : `HTTP ${response.status}`;
      const error = new Error(`${detail} (HTTP ${response.status})`.slice(0, 300)) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDiscoveryJson(
  urls: string[],
  providerKey: string,
  secret?: string,
) {
  let lastError: (Error & { status?: number }) | undefined;
  for (const url of urls) {
    for (const headers of authHeaderVariants(providerKey, secret)) {
      try {
        return await fetchJson(url, headers);
      } catch (error) {
        lastError = error instanceof Error ? error as Error & { status?: number } : new Error(String(error));
        if (lastError.status !== 401 && lastError.status !== 403) break;
      }
    }
  }
  throw lastError || new Error("Model discovery failed.");
}

export async function discoverProviderModels(connection: ProviderConnectionWithSecret) {
  const provider = getProviderDefinition(connection.providerKey);
  if (!provider) throw new Error(`Unknown provider: ${connection.providerKey}`);
  if (connection.providerKey === "codex" && connection.authType === "oauth") {
    const credentials = readCodexOAuthCredentials(connection.secret || "");
    const response = await fetch(
      "https://chatgpt.com/backend-api/codex/models?client_version=0.147.0",
      {
        headers: {
          Authorization: `Bearer ${credentials.access}`,
          "ChatGPT-Account-Id": credentials.accountId,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`Codex model discovery failed (HTTP ${response.status}).`);
    const body = await response.json() as { models?: unknown[] } | unknown[];
    const values = Array.isArray(body)
      ? body
      : Array.isArray(body.models)
        ? body.models
        : [];
    const discovered = values.map(parseDiscoveredModel).filter(Boolean) as DiscoveredModel[];
    if (!discovered.length) throw new Error("Codex returned no models for this account.");
    return discovered;
  }
  if (connection.providerKey === "google" && connection.authType === "vertex_adc") {
    return provider.models;
  }
  if (!provider.capabilities.modelDiscovery || !connection.baseUrl) {
    return provider.models;
  }
  const urls = modelEndpoints(connection.baseUrl);
  if (!urls.length) return provider.models;
  const body = await fetchDiscoveryJson(urls, connection.providerKey, connection.secret);
  const values = Array.isArray(body)
    ? body
    : (() => {
        if (!body || typeof body !== "object") return [];
        const object = body as Record<string, unknown>;
        if (Array.isArray(object.data)) return object.data;
        if (Array.isArray(object.models)) return object.models;
        if (Array.isArray(object.results)) return object.results;
        return object.models && typeof object.models === "object"
          ? Object.values(object.models)
          : [];
      })();
  const discovered = values.map(parseDiscoveredModel).filter(Boolean) as DiscoveredModel[];
  const merged = new Map(provider.models.map((model) => [model.id, { ...model } as DiscoveredModel]));
  for (const model of discovered) {
    const previous = merged.get(model.id);
    merged.set(model.id, {
      ...previous,
      ...model,
      contextWindow: mergeDiscoveredContextWindow({
        discovered: model.contextWindowDiscovered ? model.contextWindow : undefined,
        catalog: previous?.contextWindow,
      }),
      contextWindowDiscovered: Boolean(model.contextWindowDiscovered),
    });
  }
  const chatModels = [...merged.values()].filter((model) => modelSupportsChatTools(model.id, model.displayName));
  if (chatModels.length) return chatModels;
  return provider.models.filter((model) => modelSupportsChatTools(model.id, model.displayName));
}

const MODEL_CACHE_STALE_MS = 60 * 60 * 1000;
const REFRESH_FAILURE_COOLDOWN_MS = 60_000;
const inflightRefreshes = new Map<string, Promise<unknown>>();
const refreshFailureAt = new Map<string, number>();

export function providerModelCacheState(connectionId: string): "empty" | "stale" | "fresh" {
  const models = listProviderModels(connectionId);
  if (!models.length) return "empty";
  let newest = 0;
  for (const model of models) {
    const timestamp = Date.parse(model.discoveredAt);
    if (Number.isFinite(timestamp) && timestamp > newest) newest = timestamp;
  }
  if (!newest || Date.now() - newest > MODEL_CACHE_STALE_MS) return "stale";
  return "fresh";
}

export async function refreshProviderModels(connection: ProviderConnectionWithSecret) {
  const models = await discoverProviderModels(connection);
  const provider = getProviderDefinition(connection.providerKey);
  return persistDiscoveredModels(
    connection.id,
    models.map((model) => ({
      ...model,
      capabilities: {
        ...provider?.capabilities,
        ...(model.capabilities || {}),
      },
    })),
  );
}

export function scheduleProviderModelRefresh(connection: ProviderConnectionWithSecret) {
  const existing = inflightRefreshes.get(connection.id);
  if (existing) return existing;
  const failedAt = refreshFailureAt.get(connection.id);
  if (failedAt && Date.now() - failedAt < REFRESH_FAILURE_COOLDOWN_MS) {
    return Promise.resolve(listProviderModels(connection.id));
  }
  const promise = refreshProviderModels(connection)
    .then((models) => {
      refreshFailureAt.delete(connection.id);
      return models;
    })
    .catch(() => {
      refreshFailureAt.set(connection.id, Date.now());
      return listProviderModels(connection.id);
    })
    .finally(() => {
      inflightRefreshes.delete(connection.id);
    });
  inflightRefreshes.set(connection.id, promise);
  return promise;
}

export function persistDiscoveredModels(
  connectionId: string,
  models: Array<{
    id: string;
    displayName: string;
    description?: string;
    contextWindow?: number;
    contextWindowDiscovered?: boolean;
    capabilities?: ProviderModel["capabilities"];
    parameters?: ProviderModelDefinition["parameters"];
    defaultParams?: ProviderModelDefinition["defaultParams"];
    tags?: string[];
  }>,
) {
  const previous = listProviderModels(connectionId);
  const previousById = new Map(previous.map((model) => [model.id, model]));
  const persisted = models.map((model) => {
    const stored = previousById.get(model.id);
    const contextWindow = mergeDiscoveredContextWindow({
      discovered: model.contextWindowDiscovered ? model.contextWindow : undefined,
      stored: stored?.contextWindow,
      catalog: model.contextWindowDiscovered ? undefined : model.contextWindow,
    });
    return {
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      capabilities: model.capabilities,
      ...(contextWindow ? { contextWindow } : {}),
      ...(model.parameters ? { parameters: model.parameters } : {}),
      ...(model.defaultParams ? { defaultParams: model.defaultParams } : {}),
      ...(model.tags ? { tags: model.tags } : {}),
    };
  });
  saveProviderModels(connectionId, persisted);
  return persisted;
}

export function providerModelsForConnection(connection: ProviderConnectionWithSecret) {
  const provider = getProviderDefinition(connection.providerKey);
  if (!provider) return [] as ProviderModel[];
  const discovered = listProviderModels(connection.id);
  const sourceModels: ProviderModelDefinition[] = discovered.length
    ? discovered.map((model) => {
    const catalog = provider.models.find((candidate) => candidate.id === model.id);
        const family = getProviderModelDefinition(provider.key, model.id);
        return {
          ...(family || {}),
          ...(catalog || {}),
          id: model.id,
          displayName: model.displayName,
          description: model.description || catalog?.description,
          contextWindow: model.contextWindow || catalog?.contextWindow || inferContextWindow(model.id, model.displayName),
          capabilities: {
            ...provider.capabilities,
            ...(family?.capabilities || {}),
            ...(catalog?.capabilities || {}),
            ...(model.capabilities || {}),
          },
          ...(model.parameters ? { parameters: model.parameters } : {}),
          ...(model.defaultParams ? { defaultParams: model.defaultParams } : {}),
          ...(model.tags ? { tags: model.tags } : {}),
        };
      })
    : provider.models.map((model) => ({
        ...model,
        contextWindow: model.contextWindow || inferContextWindow(model.id, model.displayName),
      }));
  return sourceModels.map((model) => ({
    ...model,
    capabilities: getVerifiedProviderCapabilities(provider.key, model.id)?.verified ?? provider.capabilities,
    key: modelKey(provider.key, model.id, connection.id),
    providerKey: provider.key,
    providerName: provider.name,
    connectionId: connection.id,
    connectionLabel: connection.label,
    source: discovered.length ? "discovered" as const : "catalog" as const,
  }));
}

export async function testProviderConnection(connection: ProviderConnectionWithSecret) {
  const provider = getProviderDefinition(connection.providerKey);
  if (!provider) throw new Error(`Unknown provider: ${connection.providerKey}`);
  if (connection.providerKey === "cursor") {
    if (!connection.secret?.trim()) throw new Error("Cursor requires an API key.");
    const models = await Cursor.models.list({ apiKey: connection.secret.trim() });
    if (!models.length) throw new Error("Cursor returned no models for this connection.");
    return { ok: true, detail: `${models.length} models available.` };
  }
  if (connection.authType === "oauth") {
    if (connection.providerKey === "codex") {
      if (!connection.secret) throw new Error("OAuth connection is not completed.");
      readCodexOAuthCredentials(connection.secret, { allowExpired: true });
    } else if (!connection.secret) {
      throw new Error("OAuth connection is not completed.");
    }
    return { ok: true, detail: `${provider.name} OAuth credentials are configured.` };
  }
  if (connection.providerKey === "google" && connection.authType === "vertex_adc") {
    if (typeof connection.config.project !== "string" || !connection.config.project.trim()) {
      throw new Error("Vertex/ADC connections require a GCP project.");
    }
    return { ok: true, detail: "Google Vertex/ADC configuration is ready." };
  }
  if (provider.kind === "codex-agent") {
    if (connection.authType === "account") {
      if (!connection.secret) throw new Error("Codex account authentication requires auth.json content.");
      JSON.parse(connection.secret);
    }
    if (connection.authType === "api_key" && !connection.secret) {
      throw new Error("Codex API-key authentication requires a key.");
    }
    return { ok: true, detail: "Official Codex credentials are configured." };
  }
  if (provider.kind === "claude-agent") {
    if (!connection.secret) throw new Error("Claude Code requires an Anthropic API key.");
    return { ok: true, detail: "Anthropic API key is configured for Claude Code." };
  }
  if (provider.kind === "antigravity-agent") {
    if (!connection.secret && connection.authType !== "vertex_adc") {
      throw new Error("Antigravity connection credentials are not configured.");
    }
    if (connection.authType === "api_key" && !connection.secret) {
      throw new Error("Antigravity SDK API-key authentication requires a Gemini key.");
    }
    if (connection.authType === "vertex_adc" && !connection.config.project) {
      throw new Error("Vertex/ADC connections require a GCP project in connection settings.");
    }
    return { ok: true, detail: "Supported Antigravity SDK credentials are configured." };
  }
  const models = await discoverProviderModels(connection);
  return {
    ok: true,
    detail: `${models.length} model${models.length === 1 ? "" : "s"} available.`,
  };
}

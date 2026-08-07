import {
  listProviderModels,
  saveProviderModels,
  type ProviderConnectionWithSecret,
} from "@/lib/provider-connections";
import { getProviderDefinition } from "@/lib/providers/registry";
import {
  modelKey,
  type ProviderModel,
  type ProviderModelDefinition,
} from "@/lib/providers/types";

function endpoint(baseUrl: string | undefined, suffix: string) {
  if (!baseUrl) return undefined;
  const clean = baseUrl.replace(/\/+$/, "");
  if (clean.endsWith("/v1") && suffix.startsWith("/v1")) {
    return `${clean}${suffix.slice(3)}`;
  }
  return `${clean}${suffix}`;
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

function modelFromValue(value: unknown) {
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
  return {
    id,
    displayName,
    ...(typeof item.description === "string" ? { description: item.description } : {}),
  };
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
      throw new Error(detail.slice(0, 300));
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverProviderModels(connection: ProviderConnectionWithSecret) {
  const provider = getProviderDefinition(connection.providerKey);
  if (!provider) throw new Error(`Unknown provider: ${connection.providerKey}`);
  if (connection.providerKey === "codex" && connection.authType === "oauth") {
    const stored = connection.secret ? JSON.parse(connection.secret) as Record<string, unknown> : {};
    const record = stored["openai-codex"] && typeof stored["openai-codex"] === "object"
      ? stored["openai-codex"] as Record<string, unknown>
      : {};
    if (typeof record.access !== "string" || typeof record.accountId !== "string") {
      throw new Error("Codex OAuth credentials are missing account information.");
    }
    const response = await fetch(
      "https://chatgpt.com/backend-api/codex/models?client_version=0.147.0",
      {
        headers: {
          Authorization: `Bearer ${record.access}`,
          "ChatGPT-Account-Id": record.accountId,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) throw new Error(`Codex model discovery failed (${response.status}).`);
    const body = await response.json() as { models?: unknown[] } | unknown[];
    const values = Array.isArray(body) ? body : body.models || [];
    const discovered = values.map(modelFromValue).filter(Boolean) as Array<{
      id: string;
      displayName: string;
      description?: string;
    }>;
    if (!discovered.length) throw new Error("Codex returned no models for this account.");
    return discovered;
  }
  if (connection.providerKey === "google" && connection.authType === "vertex_adc") {
    return provider.models;
  }
  if (!provider.capabilities.modelDiscovery || !connection.baseUrl) {
    return provider.models;
  }
  const url = connection.providerKey === "google"
    ? endpoint(connection.baseUrl, "/models")
    : endpoint(connection.baseUrl, "/models");
  if (!url) return provider.models;
  const body = await fetchJson(url, authHeaders(connection.providerKey, connection.secret));
  const values = body && typeof body === "object"
    ? (Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown }).data)
        ? (body as { data: unknown[] }).data
        : Array.isArray((body as { models?: unknown }).models)
          ? (body as { models: unknown[] }).models
          : [])
    : [];
  const discovered = values.map(modelFromValue).filter(Boolean) as Array<{
    id: string;
    displayName: string;
    description?: string;
  }>;
  const merged = new Map(provider.models.map((model) => [model.id, model]));
  for (const model of discovered) merged.set(model.id, model);
  return [...merged.values()];
}

export async function refreshProviderModels(connection: ProviderConnectionWithSecret) {
  const models = await discoverProviderModels(connection);
  saveProviderModels(connection.id, models);
  return models;
}

export function providerModelsForConnection(connection: ProviderConnectionWithSecret) {
  const provider = getProviderDefinition(connection.providerKey);
  if (!provider) return [] as ProviderModel[];
  const discovered = listProviderModels(connection.id);
  const sourceModels: ProviderModelDefinition[] = discovered.length
    ? discovered.map((model) => ({
        id: model.id,
        displayName: model.displayName,
        description: model.description,
        capabilities: model.capabilities,
      }))
    : provider.models;
  return sourceModels.map((model) => ({
    ...model,
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
  if (connection.authType === "oauth") {
    if (!connection.secret) throw new Error("OAuth connection is not completed.");
    JSON.parse(connection.secret);
    return { ok: true, detail: `${provider.name} OAuth credentials are configured.` };
  }
  if (connection.providerKey === "google" && connection.authType === "vertex_adc") {
    if (typeof connection.config.project !== "string" || !connection.config.project.trim()) {
      throw new Error("Vertex/ADC connections require a GCP project.");
    }
    return { ok: true, detail: "Google Vertex/ADC configuration is ready." };
  }
  if (provider.kind === "codex-agent") {
    if (connection.authType === "account" && connection.secret) {
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

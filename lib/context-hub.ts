import { tool, jsonSchema, type ToolSet } from "ai";

const HUB_BASE = process.env.CONTEXT_HUB_URL?.trim() || "http://127.0.0.1:18083";

async function hubRequest(path: string, data?: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(HUB_BASE + path, {
    method: data ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: data ? JSON.stringify(data) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Context hub ${path} failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 4_000) };
  }
}

/**
 * On-demand personal-context tools backed by the shared context hub.
 * Replaces unconditional memory injection into every system prompt:
 * the model searches only when background knowledge is actually needed.
 */
export function contextHubTools(options: { allowWrite?: boolean; enabled?: boolean } = {}): ToolSet {
  if (options.enabled === false) return {};
  const tools: ToolSet = {
    context_search: tool({
      description:
        "Search the owner's personal context hub: devices, servers, services, projects, preferences, and long-term facts. Use before answering questions about the user's setup, before planning changes to their infrastructure, or when background knowledge about the owner would change the answer. Returns grounded context only, never secrets.",
      parameters: jsonSchema({
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to look up, e.g. 'server services', 'Windows PC', 'music preferences'.",
          },
          max_chars: {
            type: "integer",
            description: "Optional response budget in characters. Default 4000.",
            default: 4000,
          },
        },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: async (args: Record<string, unknown>) => {
        const query = String((args as Record<string, unknown>)?.query || "");
        const raw = Number((args as Record<string, unknown>)?.max_chars);
        return hubRequest("/v1/context", {
          query,
          max_chars: Number.isFinite(raw) ? Math.min(Math.max(raw, 500), 12_000) : 4_000,
        });
      },
    } as never) as ToolSet[string],
    context_profile: tool({
      description:
        "Read the owner's canonical profile: identity, core preferences, infrastructure overview, and active projects. Cheaper than context_search when a general overview is enough.",
      parameters: jsonSchema({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: async () => hubRequest("/v1/profile"),
    } as never) as ToolSet[string],
  };
  if (options.allowWrite) {
    tools.context_remember = tool({
      description:
        "Store one durable, non-secret fact about the owner in the shared context hub (fact_id is a stable snake_case key; later writes with the same id update it). Never store passwords, API keys, cookies, tokens, or auth material. Use sparingly for stable preferences and environment facts the owner confirmed.",
      parameters: jsonSchema({
        type: "object",
        properties: {
          fact_id: { type: "string", description: "Stable snake_case identifier, e.g. 'home-lab-server'." },
          text: { type: "string", description: "The fact itself, one concise sentence." },
          category: { type: "string", description: "e.g. preferences, infrastructure, devices, projects.", default: "general" },
          scope: { type: "string", description: "Scope label, e.g. global or project:<name>.", default: "global" },
          tags: { type: "array", items: { type: "string" } },
          priority: { type: "integer", description: "0-100, higher is more important.", default: 60 },
        },
        required: ["fact_id", "text"],
        additionalProperties: false,
      }),
      execute: async (args: Record<string, unknown>) => {
        const input = args as Record<string, unknown>;
        return hubRequest("/v1/facts", {
          id: String(input.fact_id || ""),
          text: String(input.text || ""),
          category: typeof input.category === "string" && input.category ? input.category : "general",
          scope: typeof input.scope === "string" && input.scope ? input.scope : "global",
          tags: Array.isArray(input.tags) ? input.tags.map((tag) => String(tag)) : [],
          priority: Number.isFinite(input.priority) ? Number(input.priority) : 60,
          source: "metis",
        });
      },
    } as never) as ToolSet[string];
  }
  return tools;
}

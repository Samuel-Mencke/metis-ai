import type { ProviderDefinition, ProviderModelDefinition } from "@/lib/providers/types";

const chatCapabilities = {
  streaming: true,
  tools: false,
  vision: true,
  agent: false,
  modelDiscovery: true,
} as const;

const compatibleCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  agent: false,
  modelDiscovery: true,
} as const;

const agentCapabilities = {
  streaming: true,
  tools: true,
  vision: true,
  agent: true,
  modelDiscovery: false,
} as const;

const ANTIGRAVITY_EFFORT_PARAMETER = {
  id: "effort",
  displayName: "Effort",
  values: [
    { value: "low", displayName: "Low" },
    { value: "medium", displayName: "Medium" },
    { value: "high", displayName: "High" },
  ],
} as const;

function models(...entries: Array<ProviderModelDefinition>) {
  return entries;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    key: "cursor",
    name: "Cursor",
    description: "Cursor Agent SDK with filesystem tools, MCP, plans, and canvases.",
    kind: "cursor-agent",
    authTypes: ["api_key"],
    capabilities: agentCapabilities,
    models: models(),
    setupHint: "Add the Cursor SDK key as a per-user connection. Cursor does not use a configurable base URL.",
  },
  {
    key: "openai",
    name: "OpenAI",
    description: "OpenAI API models through the official Vercel AI SDK provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://api.openai.com/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "gpt-5", displayName: "GPT-5", tags: ["balanced"] },
      { id: "gpt-5-mini", displayName: "GPT-5 Mini", tags: ["fast"] },
      { id: "gpt-5-codex", displayName: "GPT-5 Codex", tags: ["coding", "reasoning"] },
    ),
    setupHint: "Create an API key in the OpenAI dashboard.",
  },
  {
    key: "anthropic",
    name: "Anthropic",
    description: "Claude API models through the official Anthropic provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://api.anthropic.com/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "claude-sonnet-4-6", displayName: "Claude Sonnet", tags: ["balanced", "coding"] },
      { id: "claude-opus-4-6", displayName: "Claude Opus", tags: ["reasoning"] },
      { id: "claude-haiku-4-5", displayName: "Claude Haiku", tags: ["fast"] },
    ),
    setupHint: "Use a Claude Console API key. Claude.ai consumer OAuth is not supported for third-party apps.",
  },
  {
    key: "google",
    name: "Google Gemini",
    description: "Gemini API models through Google's official AI SDK provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    capabilities: chatCapabilities,
    models: models(
      { id: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", tags: ["fast"] },
      { id: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", tags: ["reasoning", "coding"] },
    ),
    setupHint: "Use a Google AI Studio Gemini API key.",
  },
  {
    key: "xai",
    name: "xAI / Grok",
    description: "Grok models through the official xAI provider.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://api.x.ai/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "grok-4", displayName: "Grok 4", tags: ["reasoning"] },
      { id: "grok-3-mini", displayName: "Grok 3 Mini", tags: ["fast"] },
    ),
    setupHint: "Create an API key in the xAI console.",
  },
  {
    key: "openrouter",
    name: "OpenRouter",
    description: "One connection to models from many providers.",
    kind: "ai-sdk",
    authTypes: ["api_key"],
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    capabilities: chatCapabilities,
    models: models(
      { id: "openai/gpt-5", displayName: "GPT-5 via OpenRouter", tags: ["balanced"] },
      { id: "anthropic/claude-sonnet-4-6", displayName: "Claude Sonnet via OpenRouter", tags: ["coding"] },
      { id: "google/gemini-2.5-flash", displayName: "Gemini Flash via OpenRouter", tags: ["fast"] },
    ),
    setupHint: "Create an OpenRouter API key. The model list is refreshed from OpenRouter when requested.",
  },
  {
    key: "ollama",
    name: "Ollama / Local",
    description: "Local models through an OpenAI-compatible Ollama endpoint.",
    kind: "compatible",
    authTypes: ["local", "api_key"],
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    capabilities: compatibleCapabilities,
    models: models(
      { id: "llama3.2", displayName: "Llama 3.2", tags: ["local", "fast"] },
      { id: "qwen2.5-coder", displayName: "Qwen 2.5 Coder", tags: ["local", "coding"] },
    ),
    setupHint: "Start Ollama locally. Use local mode without a key, or API-key mode when your endpoint requires one.",
  },
  {
    key: "compatible",
    name: "OpenAI-compatible",
    description: "Any provider exposing an OpenAI-compatible chat endpoint.",
    kind: "compatible",
    authTypes: ["api_key", "local"],
    capabilities: compatibleCapabilities,
    models: [],
    setupHint: "Enter the provider's base URL and optional API key.",
  },
  {
    key: "codex",
    name: "OpenAI Codex",
    description: "Codex agent through the official Codex SDK and CLI runtime.",
    kind: "codex-agent",
    authTypes: ["oauth"],
    capabilities: agentCapabilities,
    models: models(
      {
        id: "gpt-5.6-terra",
        displayName: "GPT-5.6 Terra",
        tags: ["coding", "agent"],
      },
      {
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        tags: ["balanced", "coding", "agent"],
      },
      {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        tags: ["reasoning", "agent"],
      },
      {
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        tags: ["fast", "agent"],
      },
      {
        id: "codex-auto-review",
        displayName: "Codex Auto Review",
        tags: ["coding", "agent"],
      },
    ),
    setupHint: "Use OAuth for ChatGPT/Codex usage.",
  },
  {
    key: "claude-code",
    name: "Claude Code",
    description: "Claude Code agent through Anthropic's official Agent SDK.",
    kind: "claude-agent",
    authTypes: ["oauth"],
    capabilities: agentCapabilities,
    models: models({
      id: "claude-sonnet-4-6",
      displayName: "Claude Sonnet Agent",
      tags: ["coding", "agent"],
    }),
    setupHint: "Use OAuth to connect your Claude Code account.",
  },
  {
    key: "antigravity",
    name: "Google Antigravity",
    description: "Antigravity agent through the official agy CLI.",
    kind: "antigravity-agent",
    authTypes: ["oauth"],
    capabilities: agentCapabilities,
    models: models(
      ...[
        ["gemini-3.6-flash", "Gemini 3.6 Flash", ["balanced", "agent"], "medium"],
        ["gemini-3.5-flash", "Gemini 3.5 Flash", ["balanced", "agent"], "medium"],
        ["gemini-3.1-pro", "Gemini 3.1 Pro", ["reasoning", "coding", "agent"], "high"],
        ["claude-opus-4-6-thinking", "Claude Opus 4.6 Thinking", ["reasoning", "agent"], "high"],
        ["claude-sonnet-4-6", "Claude Sonnet 4.6", ["balanced", "coding", "agent"], "medium"],
        ["gpt-oss-120b-medium", "GPT-OSS 120B", ["balanced", "agent"], "medium"],
      ].map(([id, displayName, tags, effort]) => ({
        id: id as string,
        displayName: displayName as string,
        tags: tags as string[],
        parameters: [ANTIGRAVITY_EFFORT_PARAMETER],
        defaultParams: [{ id: "effort", value: effort as string }],
      })),
    ),
    setupHint: "OAuth runs the official agy CLI remote login.",
  },
];

const providerMap = new Map(PROVIDERS.map((provider) => [provider.key, provider]));

export function getProviderDefinition(key: string) {
  return providerMap.get(key);
}

export function listProviderDefinitions() {
  return PROVIDERS;
}

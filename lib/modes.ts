import type { AgentMode, ToolPermissionCategory } from "@/lib/store";

export const TOOL_PERMISSION_CATEGORIES: ToolPermissionCategory[] = [
  "read",
  "write",
  "terminal",
  "browser",
  "memory",
  "remote",
  "plan",
  "subagent",
];

export const BUILT_IN_MODES: AgentMode[] = [
  {
    id: "agent",
    name: "Agent",
    description: "Use all available tools and make changes.",
    icon: "bot",
    instructions: "Work autonomously and use the available tools to complete the request.",
    allowedCategories: [...TOOL_PERMISSION_CATEGORIES],
    builtIn: true,
  },
  {
    id: "plan",
    name: "Plan",
    description: "Read, investigate, and create plans without changing files.",
    icon: "map",
    instructions: "You are in Plan mode. Always finish by calling create_plan with the complete plan so it opens in the side panel, then mention it as [Title](workspace://plan/<id>). Never call request_mode_change and never ask to switch to Agent — the user builds with the Build button. Inspect freely: read files, git, browser, docs, memories/notes, and remote hosts with inspect-only commands. Do not modify files, services, registry, or scheduled tasks. Research/read MCPs are allowed; provisioning and mutating child tools are not. Name independent workstreams in the plan so Build with agents can spawn clickable subagents.",
    allowedCategories: ["read", "browser", "plan"],
    builtIn: true,
  },
  {
    id: "ask",
    name: "Ask",
    description: "Answer using read-only tools.",
    icon: "message-circle-question",
    instructions: "Answer the user and investigate with read-only tools. Do not make changes.",
    allowedCategories: ["read", "browser"],
    builtIn: true,
  },
];

export function normalizeMode(mode: AgentMode): AgentMode {
  const allowed = new Set(TOOL_PERMISSION_CATEGORIES);
  return {
    id: mode.id.trim().slice(0, 80),
    name: mode.name.trim().slice(0, 80) || "Custom mode",
    description: mode.description.trim().slice(0, 300),
    icon: mode.icon.trim().slice(0, 60) || "sliders-horizontal",
    instructions: mode.instructions.slice(0, 20_000),
    allowedCategories: [...new Set(mode.allowedCategories.filter((item) => allowed.has(item)))],
    ...(mode.toolOverrides ? {
      toolOverrides: Object.fromEntries(
        Object.entries(mode.toolOverrides).slice(0, 500).map(([name, value]) => [name.slice(0, 120), Boolean(value)]),
      ),
    } : {}),
    ...(mode.builtIn ? { builtIn: true } : {}),
  };
}

export function allModes(customModes: AgentMode[] = []) {
  return [...BUILT_IN_MODES, ...customModes.filter((mode) => !BUILT_IN_MODES.some((builtIn) => builtIn.id === mode.id)).map(normalizeMode)];
}

export function modeById(id: string | undefined, customModes: AgentMode[] = []) {
  return allModes(customModes).find((mode) => mode.id === id) || BUILT_IN_MODES[0];
}

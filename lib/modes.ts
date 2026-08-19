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
    instructions: "You are Metis AI, running in the Metis AI harness. Work autonomously and use the available tools to complete the request.",
    allowedCategories: [...TOOL_PERMISSION_CATEGORIES],
    builtIn: true,
  },
  {
    id: "plan",
    name: "Plan",
    description: "Read, investigate, and create plans without changing files.",
    icon: "map",
    instructions: "Plan carefully. You may inspect and research, but do not modify files or run mutating commands.",
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

import type { ToolPart } from "@/lib/store";

export function classifyTool(name: string): ToolPart["kind"] {
  const value = name.toLowerCase();
  if (/(subagent|delegate|agent|task)/.test(value)) return "subagent";
  if (/(todo)/.test(value)) return "todo";
  if (/(note)/.test(value)) return "note";
  if (/(memory|remember)/.test(value)) return "memory";
  if (/(keyword|chat)/.test(value)) return "mcp";
  if (
    /(browser|navigate|playwright|webfetch|web_fetch|web_search|websearch|web_reader|webreader|browse_page|search_web|x_search|exa)/.test(
      value,
    )
  ) {
    return "browser";
  }
  if (value.includes("edit_plan")) return "plan";
  if (value.includes("edit_canvas")) return "canvas";
  if (value.includes("plan")) return "plan";
  if (/(edit|write|patch|replace|create_file|delete|remove|unlink)/.test(value)) return "edit";
  if (/(read|search|list|glob|grep)/.test(value)) return "read";
  if (/(shell|terminal|command|exec|run)/.test(value)) return "shell";
  if (/(mcp|connector|integration)/.test(value)) return "mcp";
  if (value.includes("canvas")) return "canvas";
  return "other";
}

export function toolDetailFromArgs(args: unknown): string | undefined {
  if (args == null) return undefined;
  const record =
    typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : null;
  const value = record
    ? record.query ??
      record.url ??
      record.command ??
      record.path ??
      record.pattern ??
      record.toolName ??
      record.prompt
    : args;
  const text = typeof value === "string" ? value : value != null ? JSON.stringify(value) : "";
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 160 ? `${compact.slice(0, 157)}…` : compact;
}

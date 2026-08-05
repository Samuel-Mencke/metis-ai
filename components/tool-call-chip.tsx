"use client";

import {
  Bot,
  Brain,
  Cable,
  ChevronRight,
  Code2,
  ClipboardList,
  FilePenLine,
  FileSearch,
  Globe2,
  ListTodo,
  LoaderCircle,
  ExternalLink,
  PanelRight,
  Terminal,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PlanWorkspaceCard } from "@/components/plan-workspace-card";
import { CanvasWorkspaceCard } from "@/components/canvas-workspace-card";

export type ToolCallData = {
  id: string;
  name: string;
  status: string;
  detail?: string;
  kind?: "plan" | "edit" | "read" | "shell" | "subagent" | "mcp" | "canvas" | "todo" | "browser" | "memory" | "other";
  path?: string;
  diff?: { before?: string; after?: string; additions?: number; deletions?: number };
  input?: string;
  result?: string;
  todos?: Array<{ id?: string; content: string; status?: string }>;
  subagent?: {
    agentId?: string;
    title?: string;
    mode?: string;
    model?: string;
    prompt?: string;
    messages?: Array<{ role: string; text: string; timestamp?: string }>;
  };
};

type ToolCallProps = ToolCallData & {
  onOpenDiff?: () => void;
  onOpenSubagent?: () => void;
  onOpenWorkspace?: () => void;
  onBuildPlan?: (plan: { title: string; content: string }) => void;
  buildDisabled?: boolean;
  onOpenRaw?: () => void;
  autoExpand?: boolean;
};

function formatStructuredValue(value: unknown, indent = 0): string {
  if (value === null) return "null";
  if (typeof value !== "object") return String(value);

  const padding = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        const formatted = formatStructuredValue(item, indent + 2);
        return typeof item === "object" && item !== null
          ? `${padding}${index}:\n${formatted}`
          : `${padding}${index}: ${formatted}`;
      })
      .join("\n");
  }

  return Object.entries(value)
    .map(([key, item]) => {
      const formatted = formatStructuredValue(item, indent + 2);
      return typeof item === "object" && item !== null
        ? `${padding}${key}:\n${formatted}`
        : `${padding}${key}: ${formatted}`;
    })
    .join("\n");
}

function formatToolOutput(value?: string): string {
  if (!value) return "";
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "status" in parsed &&
      (parsed as { status?: unknown }).status === "success" &&
      "value" in parsed &&
      Object.keys((parsed as { value?: unknown }).value ?? {}).length === 0
    ) {
      return "";
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { plan?: unknown }).plan === "string"
    ) {
      return (parsed as { plan: string }).plan;
    }
    return typeof parsed === "string" ? parsed : formatStructuredValue(parsed);
  } catch {
    // Tool output is often plain text.
  }
  return value;
}

function planInfo(input?: string, result?: string, detail?: string) {
  const sources = [input, result, detail].filter(Boolean) as string[];
  for (const source of sources) {
    try {
      const parsed = JSON.parse(source) as Record<string, unknown>;
      const value = parsed.value && typeof parsed.value === "object"
        ? parsed.value as Record<string, unknown>
        : {};
      const content = [parsed.plan, parsed.content, value.plan, value.content]
        .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
      if (content) {
        const title = [parsed.title, parsed.name, value.title, value.name]
          .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
        return {
          title: title?.trim() || "Plan",
          content: content.trim(),
        };
      }
    } catch {
      if (source.trim() && !source.trim().startsWith("{")) {
        return { title: "Plan", content: source.trim() };
      }
    }
  }
  return null;
}

function canvasInfo(input?: string, result?: string, detail?: string) {
  const sources = [input, result, detail].filter(Boolean) as string[];
  for (const source of sources) {
    try {
      const parsed = JSON.parse(source) as Record<string, unknown>;
      const value = parsed.value && typeof parsed.value === "object"
        ? parsed.value as Record<string, unknown>
        : {};
      const content = [parsed.canvas, parsed.content, value.canvas, value.content]
        .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
      if (content) {
        const title = [parsed.title, parsed.name, value.title, value.name]
          .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
        return {
          title: title?.trim() || "Canvas",
          content: content.trim(),
        };
      }
    } catch {
      if (source.trim() && !source.trim().startsWith("{")) {
        return { title: "Canvas", content: source.trim() };
      }
    }
  }
  return null;
}

function mcpDisplayInfo(name: string, input?: string, detail?: string) {
  const source = input || detail;
  let values: Record<string, unknown> = {};
  try {
    const parsed = source ? JSON.parse(source) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      values = parsed as Record<string, unknown>;
    }
  } catch {
    // MCP arguments may be plain text.
  }
  const nested = values.arguments && typeof values.arguments === "object"
    ? values.arguments as Record<string, unknown>
    : {};
  const server = typeof values.server === "string" ? values.server : undefined;
  const tool = typeof values.tool === "string"
    ? values.tool
    : typeof values.toolName === "string"
      ? values.toolName
      : undefined;
  const nestedServer = typeof nested.server === "string" ? nested.server : undefined;
  const nestedTool = typeof nested.tool === "string"
    ? nested.tool
    : typeof nested.toolName === "string"
      ? nested.toolName
      : undefined;
  const action = [nestedServer || server, nestedTool || tool].filter(Boolean).join(" · ") || name.replaceAll("_", " ");
  const description = [
    values.description,
    values.command,
    values.query,
    values.path,
    nested.description,
    nested.command,
    nested.query,
    nested.path,
  ].find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return {
    label: action,
    detail: description?.replace(/\s+/g, " ").trim(),
  };
}

export function ToolCallChip({
  name,
  status,
  detail,
  kind,
  path,
  diff,
  input,
  result,
  subagent,
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onBuildPlan,
  buildDisabled,
  onOpenRaw,
  autoExpand = false,
  todos,
}: ToolCallProps) {
  const [expanded, setExpanded] = useState(false);
  const running = status === "running";

  useEffect(() => {
    setExpanded(autoExpand);
  }, [autoExpand]);

  const config = {
    plan: { label: "Plan", icon: ClipboardList, color: "text-blue-400", border: "border-blue-400/30", bg: "bg-blue-400/10" },
    edit: { label: "File edit", icon: FilePenLine, color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/10" },
    read: { label: "Read", icon: FileSearch, color: "text-slate-300", border: "border-slate-400/30", bg: "bg-slate-400/10" },
    shell: { label: "Shell", icon: Terminal, color: "text-orange-400", border: "border-orange-400/30", bg: "bg-orange-400/10" },
    subagent: { label: "Subagent", icon: Bot, color: "text-purple-400", border: "border-purple-400/30", bg: "bg-purple-400/10" },
    mcp: { label: "MCP", icon: Cable, color: "text-cyan-400", border: "border-cyan-400/30", bg: "bg-cyan-400/10" },
    canvas: { label: "Canvas", icon: PanelRight, color: "text-pink-400", border: "border-pink-400/30", bg: "bg-pink-400/10" },
    todo: { label: "Tasks", icon: ListTodo, color: "text-blue-400", border: "border-blue-400/30", bg: "bg-blue-400/10" },
    browser: { label: "Browser", icon: Globe2, color: "text-cyan-400", border: "border-cyan-400/30", bg: "bg-cyan-400/10" },
    memory: { label: "Memory", icon: Brain, color: "text-violet-400", border: "border-violet-400/30", bg: "bg-violet-400/10" },
    other: { label: name.replaceAll("_", " "), icon: Globe2, color: "text-muted-foreground", border: "border-border/50", bg: "bg-muted/20" },
  }[kind ?? "other"];
  const Icon = config.icon;
  const clickable = kind === "edit" && Boolean(diff || path);
  const subagentClickable = kind === "subagent";
  const workspaceClickable = kind === "plan" || kind === "canvas" || kind === "browser";
  if (kind === "todo" && todos?.length) {
    const completed = todos.filter((todo) => todo.status === "completed" || todo.status === "done").length;
    return (
      <div className="my-2 w-full rounded-md border border-border/50 bg-muted/15 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <ListTodo className="size-3.5 text-blue-400" />
          <span className="font-medium text-foreground/80">Tasks</span>
          <span className="text-muted-foreground/70">{completed}/{todos.length}</span>
          {onOpenRaw ? (
            <button
              type="button"
              className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground/50 hover:bg-muted hover:text-foreground"
              aria-label="Show raw tool information"
              onClick={onOpenRaw}
            >
              <Code2 className="size-3" />
            </button>
          ) : null}
        </div>
        <div className="space-y-1">
          {todos.map((todo, index) => {
            const done = todo.status === "completed" || todo.status === "done";
            return (
              <div key={todo.id ?? `${todo.content}-${index}`} className="flex min-w-0 items-center gap-2 text-xs">
                <span className={cn("flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[9px]", done ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-400" : "border-border/70 text-muted-foreground/50")}>
                  {done ? "✓" : ""}
                </span>
                <span className={cn("min-w-0 truncate", done ? "text-muted-foreground line-through" : "text-foreground/80")}>{todo.content}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (kind === "memory") {
    const memoryOutput = formatToolOutput(result || detail || input) || "Memory updated";
    return (
      <div className="my-2 flex w-full items-start gap-2 rounded-md border border-violet-400/30 bg-violet-400/10 px-2.5 py-2 text-xs">
        <Brain className="mt-0.5 size-3.5 shrink-0 text-violet-400" />
        <div className="min-w-0">
          <p className="font-medium text-violet-300">Memory update</p>
          <p className="mt-0.5 max-h-20 overflow-hidden whitespace-pre-wrap text-foreground/75">{memoryOutput}</p>
        </div>
      </div>
    );
  }
  const outputText = formatToolOutput(result || detail || input);
  const plan = kind === "plan" ? planInfo(input, result, detail) : null;
  const mcpInfo = kind === "mcp" ? mcpDisplayInfo(name, input, detail) : undefined;
  const displayName = kind === "plan"
    ? plan?.title || ""
    : mcpInfo?.label || path || name.replaceAll("_", " ");
  const previewText = mcpInfo?.detail || path || (subagent?.prompt || outputText)?.replace(/\s+/g, " ").trim();
  const compactDetail = previewText && previewText.length > 120
    ? `${previewText.slice(0, 117)}…`
    : previewText;
  const formattedOutput =
    kind === "edit" && diff
      ? `Before:\n${diff.before || "(empty)"}\n\nAfter:\n${diff.after || "(empty)"}`
      : outputText || "No output available yet.";
  if (kind === "plan" && !running && plan) {
    return (
      <PlanWorkspaceCard
        title={plan.title}
        content={plan.content}
        onOpen={onOpenWorkspace}
        onBuild={() => onBuildPlan?.(plan)}
        buildDisabled={buildDisabled}
      />
    );
  }
  const canvas = kind === "canvas" && !running
    ? canvasInfo(input, result, detail)
    : null;
  if (canvas) {
    return (
      <CanvasWorkspaceCard
        title={canvas.title}
        content={canvas.content}
        onOpen={onOpenWorkspace}
      />
    );
  }
  return (
    <div>
      <div
          role={clickable || subagentClickable || workspaceClickable ? "button" : undefined}
          tabIndex={clickable || subagentClickable || workspaceClickable ? 0 : undefined}
          onClick={() => {
            if (clickable) onOpenDiff?.();
            else if (subagentClickable) onOpenSubagent?.();
            else if (workspaceClickable && onOpenWorkspace) onOpenWorkspace();
            else setExpanded((value) => !value);
          }}
          onKeyDown={(event) => {
            if ((clickable || subagentClickable || workspaceClickable) && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              if (clickable) onOpenDiff?.();
              else if (subagentClickable) onOpenSubagent?.();
              else if (workspaceClickable && onOpenWorkspace) onOpenWorkspace();
            }
          }}
          className={cn(
            "my-2 flex w-full max-w-full items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors",
            "border-border/50 bg-muted/15 text-xs text-muted-foreground hover:bg-muted/30 active:bg-muted/40",
            (clickable || subagentClickable || workspaceClickable) && "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
      <span className={cn("flex size-4 shrink-0 items-center justify-center", config.color)}>
        {running ? <LoaderCircle className="size-3 animate-spin" /> : <Icon className="size-3" />}
      </span>
      <div className="min-w-0 flex-1 truncate">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={cn("shrink-0 font-medium", config.color)}>{config.label}</span>
          <span className="truncate text-foreground/75">{displayName}</span>
          {kind === "subagent" && subagent?.model ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">{subagent.model}</span>
          ) : null}
          {kind === "edit" && diff ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              +{diff.additions ?? 0} -{diff.deletions ?? 0}
            </span>
          ) : null}
        </div>
        {compactDetail && !path ? <span className="ml-1 text-[11px] text-muted-foreground/65">· {compactDetail}</span> : null}
      </div>
      {workspaceClickable ? (
        <button
          type="button"
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted hover:text-foreground"
          aria-label={`Open ${kind === "canvas" ? "canvas" : kind === "plan" ? "plan" : "browser"} in side panel`}
          title={`Open ${kind === "canvas" ? "canvas" : kind === "plan" ? "plan" : "browser"}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenWorkspace?.();
          }}
        >
          <ExternalLink className="size-3" />
        </button>
      ) : null}
          {onOpenRaw ? (
            <button
              type="button"
              className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 hover:bg-muted hover:text-foreground"
              aria-label="Show raw tool information"
              onClick={(event) => {
                event.stopPropagation();
                onOpenRaw();
              }}
            >
              <Code2 className="size-3" />
            </button>
          ) : null}
        </div>
      {expanded ? (
        <div className="my-1 min-w-0 max-w-full max-h-56 overflow-x-hidden overflow-y-auto break-all rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap text-foreground/80">
          {formattedOutput}
        </div>
      ) : null}
    </div>
  );
}

export function PlanToolCallCard({
  tool,
  onOpenWorkspace,
  onBuildPlan,
  buildDisabled,
}: {
  tool: ToolCallData;
  onOpenWorkspace?: () => void;
  onBuildPlan?: (plan: { title: string; content: string }) => void;
  buildDisabled?: boolean;
}) {
  const plan = planInfo(tool.input, tool.result, tool.detail);
  if (tool.status !== "running" && plan) {
    return (
      <PlanWorkspaceCard
        title={plan.title}
        content={plan.content}
        onOpen={onOpenWorkspace}
        onBuild={() => onBuildPlan?.(plan)}
        buildDisabled={buildDisabled}
      />
    );
  }
  return (
    <ToolCallChip
      {...tool}
      onOpenWorkspace={onOpenWorkspace}
      onBuildPlan={onBuildPlan}
      buildDisabled={buildDisabled}
    />
  );
}

export function ToolCallGroup({
  tools,
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onBuildPlan,
  buildDisabled,
  onOpenRaw,
  includePlans = true,
  autoExpand = false,
}: {
  tools: ToolCallData[];
  onOpenDiff?: (tool: ToolCallData) => void;
  onOpenSubagent?: (tool: ToolCallData) => void;
  onOpenWorkspace?: (tool: ToolCallData) => void;
  onBuildPlan?: (tool: ToolCallData, plan: { title: string; content: string }) => void;
  buildDisabled?: boolean;
  onOpenRaw?: (tool: ToolCallData) => void;
  includePlans?: boolean;
  autoExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(autoExpand);
  }, [autoExpand]);
  const planTools = includePlans ? tools.filter((tool) => tool.kind === "plan") : [];
  const regularTools = tools.filter((tool) => includePlans || tool.kind !== "plan");
  const first = regularTools[0];
  const firstMcpInfo = first?.kind === "mcp"
    ? mcpDisplayInfo(first.name, first.input, first.detail)
    : undefined;
  const label = firstMcpInfo?.label || first?.name.replaceAll("_", " ") || "Tools";
  const working = tools.some((tool) => tool.status === "running");
  const renderTool = (tool: ToolCallData) => (
    <ToolCallChip
      {...tool}
      onOpenDiff={() => onOpenDiff?.(tool)}
      onOpenSubagent={() => onOpenSubagent?.(tool)}
      onOpenWorkspace={() => onOpenWorkspace?.(tool)}
      onBuildPlan={(plan) => onBuildPlan?.(tool, plan)}
      buildDisabled={buildDisabled}
      onOpenRaw={() => onOpenRaw?.(tool)}
      autoExpand={autoExpand}
    />
  );
  if (regularTools.length === 0) {
    return (
      <>
        {planTools.map((tool) => (
          <div key={tool.id}>{renderTool(tool)}</div>
        ))}
      </>
    );
  }
  return (
    <>
      {planTools.map((tool) => (
        <div key={tool.id}>{renderTool(tool)}</div>
      ))}
      {regularTools.length === 1 ? renderTool(regularTools[0]) : (
        <div className="my-4 w-full">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-muted/15 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30"
          >
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")} />
            <span className="truncate text-foreground/75">{label}</span>
            <span className="shrink-0 text-muted-foreground/70">+{regularTools.length - 1}</span>
            {working ? (
              <span className="ml-auto flex items-center" aria-label="Working">
                <LoaderCircle className="size-3.5 animate-spin text-muted-foreground/80" />
              </span>
            ) : null}
          </button>
          {expanded ? (
            <div className="mt-1 space-y-1 pl-3">
              {regularTools.map((tool) => (
                <div key={tool.id}>{renderTool(tool)}</div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}

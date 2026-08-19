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
  Palette,
  StickyNote,
  Terminal,
  Trash2,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { PlanWorkspaceCard } from "@/components/plan-workspace-card";
import { CanvasWorkspaceCard } from "@/components/canvas-workspace-card";
import { ThinkingBlock, formatThinkingDuration } from "@/components/thinking-block";

export type ToolCallData = {
  id: string;
  name: string;
  status: string;
  detail?: string;
  kind?: "plan" | "edit" | "read" | "shell" | "subagent" | "mcp" | "canvas" | "note" | "todo" | "browser" | "memory" | "other";
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
    tools?: ToolCallData[];
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

function displayedDiffStats(diff?: ToolCallData["diff"], input?: string) {
  if (!diff && !input) return null;
  if (diff && (typeof diff.additions === "number" || typeof diff.deletions === "number")) {
    if ((diff.additions ?? 0) !== 0 || (diff.deletions ?? 0) !== 0 || diff.before === diff.after) {
      return { additions: diff.additions ?? 0, deletions: diff.deletions ?? 0 };
    }
  }
  try {
    const parsed = input ? JSON.parse(input) as { edits?: Array<{ oldText?: unknown; newText?: unknown }>; content?: unknown } : null;
    if (Array.isArray(parsed?.edits)) {
      return parsed.edits.reduce(
        (stats, edit) => ({
          additions: stats.additions + (typeof edit.newText === "string" && edit.newText ? edit.newText.split("\n").length : 0),
          deletions: stats.deletions + (typeof edit.oldText === "string" && edit.oldText ? edit.oldText.split("\n").length : 0),
        }),
        { additions: 0, deletions: 0 },
      );
    }
    if (typeof parsed?.content === "string") {
      return { additions: parsed.content ? parsed.content.split("\n").length : 0, deletions: 0 };
    }
  } catch {
    // Input may be streamed plain text.
  }
  const before = (diff?.before ?? "").split("\n");
  const after = (diff?.after ?? "").split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    additions: Math.max(0, afterEnd - start),
    deletions: Math.max(0, beforeEnd - start),
  };
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
        .find((candidate): candidate is string => typeof candidate === "string");
      if (content !== undefined) {
        const title = [parsed.title, parsed.name, value.title, value.name]
          .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
        return {
          title: title?.trim() || "Plan",
          content: content.trim(),
          workspaceLink: typeof parsed.workspaceLink === "string" ? parsed.workspaceLink : undefined,
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
        .find((candidate): candidate is string => typeof candidate === "string");
      if (content !== undefined) {
        const title = [parsed.title, parsed.name, value.title, value.name]
          .find((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
        return {
          title: title?.trim() || "Canvas",
          content: content.trim(),
          workspaceLink: typeof parsed.workspaceLink === "string" ? parsed.workspaceLink : undefined,
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

function noteInfo(input?: string, result?: string, detail?: string) {
  for (const source of [result, input, detail].filter(Boolean) as string[]) {
    try {
      const parsed = JSON.parse(source) as Record<string, unknown>;
      const value = parsed.value && typeof parsed.value === "object"
        ? parsed.value as Record<string, unknown>
        : {};
      const note = [parsed.note, value.note].find(
        (candidate): candidate is Record<string, unknown> =>
          Boolean(candidate) && typeof candidate === "object" && !Array.isArray(candidate),
      );
      if (!note || typeof note.id !== "string") continue;
      return {
        id: note.id,
        title: typeof note.title === "string" && note.title.trim() ? note.title.trim() : "Untitled note",
        content: typeof note.content === "string" ? note.content : "",
      };
    } catch {
      // Tool output may still be streaming or plain text.
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

function toolDisplayInfo(kind: ToolCallData["kind"], name: string, input?: string, detail?: string, path?: string) {
  let values: Record<string, unknown> = {};
  try {
    const parsed = input ? JSON.parse(input) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) values = parsed as Record<string, unknown>;
  } catch {
    // Keep the compact fallback for streamed or plain-text arguments.
  }
  const command = [values.command, values.cmd, values.script]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const inputPath = path || [values.path, values.file, values.filePath, values.filename]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const readableName = name
    .replaceAll("_", " ")
    .replace(/^(shell|read|edit|write)\s*/i, "")
    .trim();
  const primary = kind === "shell"
    ? command || readableName
    : kind === "read" || kind === "edit"
      ? inputPath || readableName
      : readableName;
  const output = detail?.replace(/\s+/g, " ").trim();
  const extra = command && primary !== command ? command : output;
  return {
    label: primary || kind || name.replaceAll("_", " "),
    detail: extra && !isSameCompactText(primary, extra) ? extra : undefined,
  };
}

function isSameCompactText(left?: string, right?: string) {
  if (!left || !right) return false;
  const a = left.replace(/\s+/g, " ").trim().toLowerCase();
  const b = right.replace(/\s+/g, " ").trim().replace(/…$/u, "").trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export const ToolCallChip = memo(function ToolCallChip({
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
  const [expanded, setExpanded] = useState(Boolean(autoExpand));
  const running = ["running", "in_progress", "pending", "started", "executing", "queued"].includes(status.toLowerCase());

  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  const config = {
    plan: { label: "Plan", icon: ClipboardList, color: "text-blue-400", border: "border-blue-400/30", bg: "bg-blue-400/10" },
    edit: { label: "File edit", icon: FilePenLine, color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/10" },
    read: { label: "Read", icon: FileSearch, color: "text-slate-300", border: "border-slate-400/30", bg: "bg-slate-400/10" },
    shell: { label: "Shell", icon: Terminal, color: "text-orange-400", border: "border-orange-400/30", bg: "bg-orange-400/10" },
    subagent: { label: "Subagent", icon: Bot, color: "text-purple-400", border: "border-purple-400/30", bg: "bg-purple-400/10" },
    mcp: { label: "MCP", icon: Cable, color: "text-cyan-400", border: "border-cyan-400/30", bg: "bg-cyan-400/10" },
    canvas: { label: "Canvas", icon: Palette, color: "text-pink-400", border: "border-pink-400/30", bg: "bg-pink-400/10" },
    note: { label: "Note", icon: StickyNote, color: "text-yellow-300", border: "border-yellow-300/30", bg: "bg-yellow-300/10" },
    todo: { label: "Tasks", icon: ListTodo, color: "text-blue-400", border: "border-blue-400/30", bg: "bg-blue-400/10" },
    browser: { label: "Browser", icon: Globe2, color: "text-cyan-400", border: "border-cyan-400/30", bg: "bg-cyan-400/10" },
    memory: { label: "Memory", icon: Brain, color: "text-violet-400", border: "border-violet-400/30", bg: "bg-violet-400/10" },
    other: { label: name.replaceAll("_", " "), icon: Globe2, color: "text-muted-foreground", border: "border-border/50", bg: "bg-muted/20" },
  }[kind ?? "other"];
  const deleteTool = /(^|[._:/-])(delete|remove|unlink)(?=[._:/-]|$)/i.test(name);
  const Icon = deleteTool && kind === "edit" ? Trash2 : config.icon;
  const toolLabel = deleteTool && kind === "edit" ? "File delete" : config.label;
  const clickable = kind === "edit" && Boolean(diff || path);
  const subagentClickable = kind === "subagent";
  const workspaceClickable = kind === "plan" || kind === "canvas" || kind === "browser";
  const detailsToggleable = !clickable && !subagentClickable && !workspaceClickable;
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
  const plan = kind === "plan" ? planInfo(input, result, detail) : null;
  const mcpInfo = kind === "mcp" ? mcpDisplayInfo(name, input, detail) : undefined;
  const displayName = kind === "plan"
    ? plan?.title || ""
    : mcpInfo?.label || path || name.replaceAll("_", " ");
  const genericInfo = kind !== "plan" && kind !== "mcp"
    ? toolDisplayInfo(kind, name, input, detail, path)
    : undefined;
  const compactName = genericInfo?.label || displayName;
  const previewText = mcpInfo?.detail
    || genericInfo?.detail
    || (kind === "subagent" ? subagent?.prompt : undefined)
    || (kind === "shell" ? formatToolOutput(result) : undefined);
  const compactDetail = previewText && !isSameCompactText(compactName, previewText)
    ? (previewText.length > 120 ? `${previewText.slice(0, 117)}…` : previewText)
    : undefined;
  const diffStats = displayedDiffStats(diff, input);
  if (kind === "plan" && !running && plan) {
    return (
      <PlanWorkspaceCard
        title={plan.title}
        content={plan.content}
        workspaceLink={plan.workspaceLink}
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
        workspaceLink={canvas.workspaceLink}
        onOpen={onOpenWorkspace}
      />
    );
  }
  const note = kind === "note" && !running ? noteInfo(input, result, detail) : null;
  if (note) {
    return (
      <section className="my-2.5 w-full rounded-lg border border-border/50 border-l-yellow-300/70 bg-muted/20 p-2.5">
        <div className="flex items-start gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-yellow-300/10 text-yellow-300">
            <StickyNote className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-wide text-yellow-300/80">Note ready</p>
            <a
              href={`#note-${note.id}`}
              className="block truncate text-[13px] font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary"
              onClick={(event) => {
                event.preventDefault();
                window.dispatchEvent(new CustomEvent("ai-chat:open-note", { detail: { id: note.id } }));
              }}
            >
              {note.title}
            </a>
            <p className="mt-0.5 max-h-20 overflow-hidden whitespace-pre-wrap text-xs text-muted-foreground">
              {note.content || "No note details available yet."}
            </p>
            <p className="mt-1 truncate text-[10px] text-muted-foreground/70">note://{note.id}</p>
          </div>
          <a
            href={`#note-${note.id}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open note"
            title="Open note"
            onClick={(event) => {
              event.preventDefault();
              window.dispatchEvent(new CustomEvent("ai-chat:open-note", { detail: { id: note.id } }));
            }}
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
        <div className="mt-2 flex justify-end">
          <a
            href={`#note-${note.id}`}
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              window.dispatchEvent(new CustomEvent("ai-chat:open-note", { detail: { id: note.id } }));
            }}
          >
            Open note
          </a>
        </div>
      </section>
    );
  }
  return (
    <div>
      <div
          role={clickable || subagentClickable || workspaceClickable || detailsToggleable ? "button" : undefined}
          tabIndex={clickable || subagentClickable || workspaceClickable || detailsToggleable ? 0 : undefined}
          aria-expanded={detailsToggleable ? expanded : undefined}
          onClick={() => {
            if (clickable) onOpenDiff?.();
            else if (subagentClickable) onOpenSubagent?.();
            else if (workspaceClickable && onOpenWorkspace) onOpenWorkspace();
            else setExpanded((value) => !value);
          }}
          onKeyDown={(event) => {
            if ((clickable || subagentClickable || workspaceClickable || detailsToggleable) && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              if (clickable) onOpenDiff?.();
              else if (subagentClickable) onOpenSubagent?.();
              else if (workspaceClickable && onOpenWorkspace) onOpenWorkspace();
              else setExpanded((value) => !value);
            }
          }}
          className={cn(
            "my-2 flex w-full max-w-full items-center gap-2 rounded-md border px-2 py-1 text-left transition-colors",
            "border-border/50 bg-muted/15 text-xs text-muted-foreground hover:bg-muted/30 active:bg-muted/40",
            "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
      {detailsToggleable ? (
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground/50 transition-transform", expanded && "rotate-90")} />
      ) : null}
      <span className={cn("flex size-4 shrink-0 items-center justify-center", config.color)}>
        {running ? <LoaderCircle className="size-3 animate-spin" /> : <Icon className="size-3" />}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className={cn("shrink-0 font-medium", deleteTool ? "text-rose-400" : config.color)}>
            {toolLabel}
          </span>
          {compactName && compactName.toLocaleLowerCase() !== toolLabel.toLocaleLowerCase() ? (
            <span className="min-w-0 truncate text-foreground/75">{compactName}</span>
          ) : null}
          {kind === "subagent" && subagent?.model ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">{subagent.model}</span>
          ) : null}
          {kind === "edit" && diffStats ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              +{diffStats.additions} -{diffStats.deletions}
            </span>
          ) : null}
          {compactDetail && !path ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground/65">· {compactDetail}</span>
          ) : null}
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
        <div className="my-1 min-w-0 max-w-full max-h-72 space-y-2 overflow-x-hidden overflow-y-auto rounded-md border border-border/40 bg-muted/20 px-2.5 py-2 text-[11px] leading-4 text-foreground/80">
          {input ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Request</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{formatToolOutput(input)}</pre>
            </section>
          ) : null}
          {kind === "edit" && diff ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground">File diff</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{`Before:\n${diff.before || "(empty)"}\n\nAfter:\n${diff.after || "(empty)"}`}</pre>
            </section>
          ) : null}
          {result || detail ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Response</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{formatToolOutput(result || detail)}</pre>
            </section>
          ) : null}
          {!input && !(kind === "edit" && diff) && !result && !detail ? "No output available yet." : null}
        </div>
      ) : null}
    </div>
  );
});

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

export type ActivityThinking = {
  text: string;
  done?: boolean;
  durationMs?: number;
};

export type ActivityEntry =
  | { type: "thinking"; thinking: ActivityThinking }
  | { type: "tool"; tool: ToolCallData };

export const ToolCallGroup = memo(function ToolCallGroup({
  tools,
  thinking = [],
  activity,
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onBuildPlan,
  buildDisabled,
  onOpenRaw,
  includePlans = true,
  autoExpand = false,
}: {
  tools?: ToolCallData[];
  thinking?: ActivityThinking[];
  activity?: ActivityEntry[];
  onOpenDiff?: (tool: ToolCallData) => void;
  onOpenSubagent?: (tool: ToolCallData) => void;
  onOpenWorkspace?: (tool: ToolCallData) => void;
  onBuildPlan?: (tool: ToolCallData, plan: { title: string; content: string }) => void;
  buildDisabled?: boolean;
  onOpenRaw?: (tool: ToolCallData) => void;
  includePlans?: boolean;
  autoExpand?: boolean;
}) {
  const [expanded, setExpanded] = useState(Boolean(autoExpand));
  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  const entries: ActivityEntry[] = activity ?? [
    ...thinking.map((item) => ({ type: "thinking" as const, thinking: item })),
    ...(tools ?? []).map((tool) => ({ type: "tool" as const, tool })),
  ];
  const allTools = entries.filter((entry): entry is { type: "tool"; tool: ToolCallData } => entry.type === "tool").map((entry) => entry.tool);
  const thinkingItems = entries
    .filter((entry): entry is { type: "thinking"; thinking: ActivityThinking } => entry.type === "thinking")
    .map((entry) => entry.thinking);
  const planTools = includePlans ? allTools.filter((tool) => tool.kind === "plan") : [];
  const noteTools = allTools.filter((tool) => tool.kind === "note");
  const regularEntries = entries.filter((entry) => {
    if (entry.type === "thinking") return Boolean(entry.thinking.text?.trim()) || entry.thinking.done === false;
    if (entry.tool.kind === "note") return false;
    if (!includePlans && entry.tool.kind === "plan") return false;
    return true;
  });
  const regularTools = regularEntries
    .filter((entry): entry is { type: "tool"; tool: ToolCallData } => entry.type === "tool")
    .map((entry) => entry.tool);
  const first = regularTools[0];
  const firstMcpInfo = first?.kind === "mcp"
    ? mcpDisplayInfo(first.name, first.input, first.detail)
    : undefined;
  const working = regularTools.some((tool) => tool.status === "running")
    || thinkingItems.some((item) => item.done === false);
  const thinkingMs = thinkingItems.reduce((sum, item) => sum + (item.durationMs ?? 0), 0);
  const durationLabel = formatThinkingDuration(thinkingMs);
  const thinkingDone = thinkingItems.length === 0 || thinkingItems.every((item) => item.done !== false);
  const thinkLabel = thinkingItems.length === 0
    ? null
    : thinkingDone
      ? (durationLabel ? `Thought for ${durationLabel}` : "Thought")
      : "Thinking";
  const toolLabel = regularTools.length === 0
    ? null
    : regularTools.length === 1
      ? (firstMcpInfo?.label || first?.name.replaceAll("_", " ") || "Tool")
      : `${regularTools.length} tools`;
  const label = [thinkLabel, toolLabel].filter(Boolean).join(" · ") || "Activity";
  const useDropdown = thinkingItems.some((item) => item.text?.trim() || item.done === false) || regularTools.length > 1;

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
  const renderEntry = (entry: ActivityEntry, index: number) => {
    if (entry.type === "thinking") {
      if (!entry.thinking.text?.trim() && entry.thinking.done !== false) return null;
      return (
        <ThinkingBlock
          key={`thinking-${index}`}
          text={entry.thinking.text || "…"}
          done={entry.thinking.done !== false}
          durationMs={entry.thinking.durationMs}
          embedded
        />
      );
    }
    return <div key={entry.tool.id}>{renderTool(entry.tool)}</div>;
  };

  if (regularEntries.length === 0) {
    return (
      <>
        {planTools.map((tool) => (
          <div key={tool.id}>{renderTool(tool)}</div>
        ))}
        {noteTools.map((tool) => (
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
      {noteTools.map((tool) => (
        <div key={tool.id}>{renderTool(tool)}</div>
      ))}
      {!useDropdown ? renderTool(regularTools[0]) : (
        <div className="my-2 w-full">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
            className="flex w-full items-center gap-2 rounded-md border border-border/50 bg-muted/15 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/30"
          >
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")} />
            <span className="truncate text-foreground/75">{label}</span>
            {working ? (
              <span className="ml-auto flex items-center" aria-label="Working">
                <LoaderCircle className="size-3.5 animate-spin text-muted-foreground/80" />
              </span>
            ) : null}
          </button>
          {expanded ? (
            <div className="mt-1 space-y-2 pl-3">
              {regularEntries.map((entry, index) => renderEntry(entry, index))}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
});

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
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import { PlanWorkspaceCard } from "@/components/plan-workspace-card";
import { planLooksParallelizable } from "@/lib/modes";
import { CanvasWorkspaceCard } from "@/components/canvas-workspace-card";
import { isToolRunning, todosFromToolPayload, toolCallHeadline, toolGroupLabel } from "@/lib/tool-call-display";

const toolCallTriggerClass =
  "inline-flex max-w-full cursor-pointer items-center gap-1 appearance-none rounded-none border-0 bg-transparent p-0 text-left text-[11px] font-light text-muted-foreground/70 shadow-none ring-0 outline-none transition-colors hover:bg-transparent hover:text-muted-foreground focus-visible:ring-0";

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
  onBuildPlan?: (plan: { title: string; content: string; workspaceLink?: string }, options?: { multiAgent?: boolean }) => void;
  buildDisabled?: boolean;
  onOpenRaw?: () => void;
  autoExpand?: boolean;
  locked?: boolean;
  hostnames?: Record<string, string>;
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
          workspaceLink: typeof parsed.workspaceLink === "string"
            ? parsed.workspaceLink
            : typeof value.workspaceLink === "string"
              ? value.workspaceLink
              : typeof parsed.id === "string"
                ? `workspace://plan/${parsed.id}`
                : undefined,
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
  locked = false,
  todos,
  hostnames,
}: ToolCallProps) {
  const [userOpen, setUserOpen] = useState(false);
  const running = isToolRunning(status);
  const expanded = locked ? autoExpand : autoExpand || userOpen;
  const todoItems = todos?.length ? todos : todosFromToolPayload(input, result);

  const config = {
    plan: { label: "Plan", icon: ClipboardList },
    edit: { label: "File edit", icon: FilePenLine },
    read: { label: "Read", icon: FileSearch },
    shell: { label: "Shell", icon: Terminal },
    subagent: { label: "Subagent", icon: Bot },
    mcp: { label: "MCP", icon: Cable },
    canvas: { label: "Canvas", icon: Palette },
    note: { label: "Note", icon: StickyNote },
    todo: { label: "Tasks", icon: ListTodo },
    browser: { label: "Browser", icon: Globe2 },
    memory: { label: "Memory", icon: Brain },
    other: { label: name.replaceAll("_", " "), icon: Globe2 },
  }[kind ?? "other"];
  const deleteTool = /(^|[._:/-])(delete|remove|unlink)(?=[._:/-]|$)/i.test(name);
  const Icon = deleteTool && kind === "edit" ? Trash2 : config.icon;
  const headline = toolCallHeadline({ name, kind, input, detail, path, hostnames });
  const clickable = kind === "edit" && Boolean(diff || path);
  const subagentClickable = kind === "subagent";
  const workspaceClickable = kind === "plan" || kind === "canvas" || kind === "browser";
  if (kind === "todo" && todoItems?.length) {
    const completed = todoItems.filter((todo) => todo.status === "completed" || todo.status === "done").length;
    return (
      <div className="my-2 w-full rounded-md border border-border/50 bg-muted/15 px-2.5 py-2">
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <ListTodo className="size-3.5 text-blue-400" />
          <span className="font-medium text-foreground/80">Tasks</span>
          <span className="text-muted-foreground/70">{completed}/{todoItems.length}</span>
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
          {todoItems.map((todo, index) => {
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
  const previewText = headline.preview;
  const diffStats = displayedDiffStats(diff, input);
  if (kind === "plan" && !running && plan) {
    return (
      <PlanWorkspaceCard
        title={plan.title}
        content={plan.content}
        workspaceLink={plan.workspaceLink}
        onOpen={onOpenWorkspace}
        onBuild={() => onBuildPlan?.(plan)}
        onBuildWithAgents={() => onBuildPlan?.(plan, { multiAgent: true })}
        showMultiAgent={planLooksParallelizable(plan.content)}
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
    <div className="my-0.5 w-full min-w-0" style={{ overflowAnchor: "none" }}>
      <div className="group flex w-full min-w-0 items-center gap-1">
        <button
          type="button"
          className={cn(toolCallTriggerClass, "min-w-0 flex-1")}
          onClick={() => {
            if (subagentClickable && onOpenSubagent) {
              onOpenSubagent();
              return;
            }
            if (locked) return;
            setUserOpen((open) => !open);
          }}
        >
          {running ? (
            <LoaderCircle className="size-3 shrink-0 animate-spin" />
          ) : (
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")} />
          )}
          <Icon className="size-3 shrink-0 opacity-70" />
          <span className={cn("truncate", deleteTool && "text-rose-400/80")}>{headline.title}</span>
          {previewText ? (
            <span className="hidden truncate text-muted-foreground/45 sm:inline">· {previewText}</span>
          ) : null}
          {kind === "subagent" && subagent?.model ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/50">{subagent.model}</span>
          ) : null}
          {kind === "edit" && diffStats ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/50">
              +{diffStats.additions} -{diffStats.deletions}
            </span>
          ) : null}
        </button>
        {clickable ? (
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
            aria-label="Open file diff"
            title="Open file diff"
            onClick={(event) => {
              event.stopPropagation();
              onOpenDiff?.();
            }}
          >
            <FilePenLine className="size-3" />
          </button>
        ) : null}
        {subagentClickable ? (
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded text-violet-300/80 opacity-100 transition-opacity hover:bg-muted hover:text-foreground"
            aria-label="Open subagent"
            title="Open subagent"
            onClick={(event) => {
              event.stopPropagation();
              onOpenSubagent?.();
            }}
          >
            <ExternalLink className="size-3" />
          </button>
        ) : null}
        {workspaceClickable ? (
          <button
            type="button"
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
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
            className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
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
        <div className="my-1 min-w-0 max-h-72 max-w-full space-y-2 overflow-x-hidden overflow-y-auto pl-4 text-[11px] font-light leading-4 text-muted-foreground/80">
          {input ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Request</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{formatToolOutput(input)}</pre>
            </section>
          ) : null}
          {kind === "edit" && diff ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">File diff</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{`Before:\n${diff.before || "(empty)"}\n\nAfter:\n${diff.after || "(empty)"}`}</pre>
            </section>
          ) : null}
          {result || detail ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Response</p>
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
  hostnames,
}: {
  tool: ToolCallData;
  onOpenWorkspace?: () => void;
  onBuildPlan?: (plan: { title: string; content: string; workspaceLink?: string }, options?: { multiAgent?: boolean }) => void;
  buildDisabled?: boolean;
  hostnames?: Record<string, string>;
}) {
  const plan = planInfo(tool.input, tool.result, tool.detail);
  if (tool.status !== "running" && plan) {
    return (
      <PlanWorkspaceCard
        title={plan.title}
        content={plan.content}
        workspaceLink={plan.workspaceLink}
        onOpen={onOpenWorkspace}
        onBuild={() => onBuildPlan?.(plan)}
        onBuildWithAgents={() => onBuildPlan?.(plan, { multiAgent: true })}
        showMultiAgent={planLooksParallelizable(plan.content)}
        buildDisabled={buildDisabled}
      />
    );
  }
  return (
    <ToolCallChip
      {...tool}
      hostnames={hostnames}
      onOpenWorkspace={onOpenWorkspace}
      onBuildPlan={onBuildPlan}
      buildDisabled={buildDisabled}
    />
  );
}

export const ToolCallGroup = memo(function ToolCallGroup({
  tools,
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onBuildPlan,
  buildDisabled,
  onOpenRaw,
  includePlans = true,
  autoExpand = false,
  live = false,
  hostnames,
}: {
  tools: ToolCallData[];
  onOpenDiff?: (tool: ToolCallData) => void;
  onOpenSubagent?: (tool: ToolCallData) => void;
  onOpenWorkspace?: (tool: ToolCallData) => void;
  onBuildPlan?: (tool: ToolCallData, plan: { title: string; content: string; workspaceLink?: string }, options?: { multiAgent?: boolean }) => void;
  buildDisabled?: boolean;
  onOpenRaw?: (tool: ToolCallData) => void;
  includePlans?: boolean;
  autoExpand?: boolean;
  live?: boolean;
  hostnames?: Record<string, string>;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const planTools = includePlans ? tools.filter((tool) => tool.kind === "plan") : [];
  const noteTools = tools.filter((tool) => tool.kind === "note");
  const todoTools = tools.filter((tool) => tool.kind === "todo");
  const regularTools = tools.filter(
    (tool) =>
      tool.kind !== "note" &&
      tool.kind !== "todo" &&
      (includePlans || tool.kind !== "plan"),
  );
  const groupTitle = toolGroupLabel(regularTools.length, regularTools.map((tool) => tool.kind));
  const showStack = Boolean(live);
  const groupOpen = userOpen || Boolean(autoExpand && !showStack);
  const lastToolId = regularTools[regularTools.length - 1]?.id;
  const renderTool = (tool: ToolCallData) => (
    <ToolCallChip
      {...tool}
      hostnames={hostnames}
      onOpenDiff={() => onOpenDiff?.(tool)}
      onOpenSubagent={() => onOpenSubagent?.(tool)}
      onOpenWorkspace={() => onOpenWorkspace?.(tool)}
      onBuildPlan={(plan, options) => onBuildPlan?.(tool, plan, options)}
      buildDisabled={buildDisabled}
      onOpenRaw={() => onOpenRaw?.(tool)}
      autoExpand={showStack && tool.id === lastToolId}
      locked={showStack}
    />
  );
  if (regularTools.length === 0) {
    return (
      <>
        {planTools.map((tool) => (
          <div key={tool.id}>{renderTool(tool)}</div>
        ))}
        {noteTools.map((tool) => (
          <div key={tool.id}>{renderTool(tool)}</div>
        ))}
        {todoTools.map((tool) => (
          <div key={tool.id}>{renderTool(tool)}</div>
        ))}
      </>
    );
  }
  return (
    <div className="w-full min-w-0" style={{ overflowAnchor: "none" }}>
      {planTools.map((tool) => (
        <div key={tool.id}>{renderTool(tool)}</div>
      ))}
      {noteTools.map((tool) => (
        <div key={tool.id}>{renderTool(tool)}</div>
      ))}
      {todoTools.map((tool) => (
        <div key={tool.id}>{renderTool(tool)}</div>
      ))}
      {regularTools.length === 1 || showStack ? (
        <div className="flex flex-col">
          {regularTools.map((tool) => (
            <div key={tool.id}>{renderTool(tool)}</div>
          ))}
        </div>
      ) : (
        <div className="my-1 w-full">
          <button
            type="button"
            className={toolCallTriggerClass}
            onClick={() => setUserOpen((open) => !open)}
          >
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", groupOpen && "rotate-90")} />
            <span className="truncate">{groupTitle}</span>
          </button>
          {groupOpen ? (
            <div className="mt-0.5 space-y-0.5 pl-4">
              {regularTools.map((tool) => (
                <div key={tool.id}>{renderTool(tool)}</div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
});

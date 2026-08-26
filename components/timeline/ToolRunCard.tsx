"use client";

import { ChevronRight, LoaderCircle, FilePenLine, ExternalLink, Code2, Trash2 } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/utils";
import type { TimelineToolItem } from "@/lib/timeline/reducer";

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  edit: FilePenLine,
  read: FilePenLine,
  shell: FilePenLine,
  browser: FilePenLine,
  subagent: FilePenLine,
  mcp: FilePenLine,
  other: FilePenLine,
};

function formatDuration(startedAt: string, completedAt?: string): string | null {
  if (!completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10 && !Number.isInteger(s)) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
}

function isDeleteTool(name: string, kind: string): boolean {
  return /(^|[._:/-])(delete|remove|unlink)(?=[._:/-]|$)/i.test(name) && kind === "edit";
}

interface ToolRunCardProps {
  tool: TimelineToolItem;
  nested?: boolean;
  onOpenDiff?: () => void;
  onOpenSubagent?: () => void;
  onOpenWorkspace?: () => void;
  onOpenRaw?: () => void;
}

export const ToolRunCard = memo(function ToolRunCard({
  tool,
  nested = false,
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onOpenRaw,
}: ToolRunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const running = tool.status === "in_progress";
  const duration = formatDuration(tool.startedAt, tool.completedAt);
  const deleteTool = isDeleteTool(tool.name, "edit");
  const Icon = TOOL_ICONS["edit"];

  const clickable = tool.name === "edit" && Boolean(tool.output);
  const subagentClickable = tool.name === "subagent";
  const workspaceClickable = ["plan", "canvas", "browser"].includes("edit");

  if (nested) {
    return (
      <div className="w-full min-w-0" style={{ overflowAnchor: "none" }}>
        <div className={cn("group flex w-full min-w-0 items-center gap-1", "my-0")}>
          <button
            type="button"
            className={cn(
              "inline-flex max-w-full cursor-pointer items-center gap-1 appearance-none rounded-none border-0 bg-transparent p-0 text-left text-[11px] font-light text-muted-foreground/70 shadow-none ring-0 outline-none transition-colors hover:bg-transparent hover:text-muted-foreground focus-visible:ring-0",
              "min-w-0 flex-1",
            )}
            onClick={() => {
              if (subagentClickable && onOpenSubagent) {
                onOpenSubagent();
                return;
              }
              setExpanded((v) => !v);
            }}
          >
            {running ? (
              <LoaderCircle className="size-3 shrink-0 animate-spin" />
            ) : (
              <ChevronRight className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")} />
            )}
            <Icon className="size-3 shrink-0 opacity-70" />
            <span className={cn("truncate", deleteTool && "text-rose-400/80")}>{tool.name}</span>
            {duration ? <span className="shrink-0 text-[10px] text-muted-foreground/50">{duration}</span> : null}
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
            {tool.input ? (
              <section>
                <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Request</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(tool.input, null, 2)}</pre>
              </section>
            ) : null}
            {tool.output ? (
              <section>
                <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Response</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(tool.output, null, 2)}</pre>
              </section>
            ) : null}
            {tool.error ? (
              <section>
                <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-rose-400/80">Error</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-rose-400/80">{tool.error}</pre>
              </section>
            ) : null}
            {!tool.input && !tool.output && !tool.error ? "No output available yet." : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0" style={{ overflowAnchor: "none" }}>
      <div className="group flex w-full min-w-0 items-center gap-1">
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full cursor-pointer items-center gap-1 appearance-none rounded-none border-0 bg-transparent p-0 text-left text-[11px] font-light text-muted-foreground/70 shadow-none ring-0 outline-none transition-colors hover:bg-transparent hover:text-muted-foreground focus-visible:ring-0",
            "min-w-0 flex-1",
            "my-0.5",
          )}
          onClick={() => {
            if (subagentClickable && onOpenSubagent) {
              onOpenSubagent();
              return;
            }
            setExpanded((v) => !v);
          }}
        >
          {running ? (
            <LoaderCircle className="size-3 shrink-0 animate-spin" />
          ) : (
            <ChevronRight className={cn("size-3 shrink-0 transition-transform", expanded && "rotate-90")} />
          )}
          <Icon className="size-3 shrink-0 opacity-70" />
          <span className={cn("truncate", deleteTool && "text-rose-400/80")}>{tool.name}</span>
          {duration ? <span className="shrink-0 text-[10px] text-muted-foreground/50">{duration}</span> : null}
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
            aria-label="Open in side panel"
            title="Open in side panel"
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
          {tool.input ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Request</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(tool.input, null, 2)}</pre>
            </section>
          ) : null}
          {tool.output ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Response</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono">{JSON.stringify(tool.output, null, 2)}</pre>
            </section>
          ) : null}
          {tool.error ? (
            <section>
              <p className="mb-1 font-sans text-[10px] font-medium uppercase tracking-wide text-rose-400/80">Error</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-rose-400/80">{tool.error}</pre>
            </section>
          ) : null}
          {!tool.input && !tool.output && !tool.error ? "No output available yet." : null}
        </div>
      ) : null}
    </div>
  );
});

ToolRunCard.displayName = "ToolRunCard";
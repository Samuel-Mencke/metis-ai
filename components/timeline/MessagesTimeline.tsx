"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ToolRunCard } from "./ToolRunCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { ContextMeter } from "./ContextMeter";
import type { TimelineItem, TimelineToolItem, TimelineReasoningItem, TimelineRequestItem } from "@/lib/timeline/reducer";

interface MessagesTimelineProps {
  items: TimelineItem[];
  contextUsed?: number;
  contextTotal?: number;
  contextEffectiveTotal?: number;
  contextMode?: "normal" | "limited";
  onOpenDiff?: (tool: TimelineToolItem) => void;
  onOpenSubagent?: (tool: TimelineToolItem) => void;
  onOpenWorkspace?: (tool: TimelineToolItem) => void;
  onOpenRaw?: (tool: TimelineToolItem) => void;
}

function groupToolsByItemId(tools: TimelineToolItem[]): Map<string, TimelineToolItem[]> {
  const groups = new Map<string, TimelineToolItem[]>();
  for (const tool of tools) {
    const existing = groups.get(tool.itemId) || [];
    existing.push(tool);
    groups.set(tool.itemId, existing);
  }
  return groups;
}

function renderToolGroup(
  tools: TimelineToolItem[],
  props: Pick<
    MessagesTimelineProps,
    | "onOpenDiff"
    | "onOpenSubagent"
    | "onOpenWorkspace"
    | "onOpenRaw"
  >,
) {
  return tools.map((tool, index) => (
    <ToolRunCard
      key={`${tool.itemId}-${index}`}
      tool={tool}
      nested={index > 0}
      onOpenDiff={() => props.onOpenDiff?.(tool)}
      onOpenSubagent={() => props.onOpenSubagent?.(tool)}
      onOpenWorkspace={() => props.onOpenWorkspace?.(tool)}
      onOpenRaw={() => props.onOpenRaw?.(tool)}
    />
  ));
}

export const MessagesTimeline = memo(function MessagesTimeline({
  items,
  contextUsed,
  contextTotal,
  contextEffectiveTotal,
  contextMode = "normal",
  onOpenDiff,
  onOpenSubagent,
  onOpenWorkspace,
  onOpenRaw,
}: MessagesTimelineProps) {
  const tools = useMemo(
    () => items.filter((item): item is TimelineToolItem => item.kind === "tool"),
    [items],
  );

  const reasoning = useMemo(
    () => items.filter((item): item is TimelineReasoningItem => item.kind === "reasoning"),
    [items],
  );

  const requests = useMemo(
    () => items.filter((item): item is TimelineRequestItem => item.kind === "request"),
    [items],
  );

  const content = useMemo(
    () => items.filter((item) => item.kind === "content"),
    [items],
  );

  const toolGroups = useMemo(() => groupToolsByItemId(tools), [tools]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      {contextUsed !== undefined && contextTotal !== undefined && (
        <div className="flex w-full items-center justify-between border-b border-border/50 pb-2">
          <ContextMeter
            usedTokens={contextUsed}
            totalTokens={contextTotal}
            effectiveTotalTokens={contextEffectiveTotal}
            mode={contextMode}
            compact
          />
        </div>
      )}

      <div className="flex-1 min-w-0 overflow-y-auto space-y-2">
        {Array.from(toolGroups.entries()).map(([itemId, groupTools]) => (
          <div key={itemId} className="space-y-1">
            {renderToolGroup(groupTools, {
              onOpenDiff,
              onOpenSubagent,
              onOpenWorkspace,
              onOpenRaw,
            })}
          </div>
        ))}

        {reasoning.map((r) => (
          <ReasoningBlock key={r.itemId} reasoning={r} />
        ))}

        {requests.map((req) => (
          <div
            key={req.requestId}
            className="my-1 flex w-full items-start gap-2 px-1 py-1.5 rounded border border-border/50 bg-muted/30"
          >
            <div className="flex size-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
              <span className="text-[10px] font-medium">?</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-foreground">{req.title || req.requestKind}</p>
              {req.detail && <p className="mt-0.5 text-[11px] text-muted-foreground">{req.detail}</p>}
              {req.options?.length && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {req.options.map((opt, i) => (
                    <button
                      key={opt.id || i}
                      type="button"
                      className="rounded border border-border/50 bg-background px-2 py-0.5 text-[10px] text-foreground hover:bg-muted"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              {(req.decision || req.respondedAt) && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Decision: <span className="font-medium capitalize">{req.decision || "answered"}</span>
                </p>
              )}
            </div>
          </div>
        ))}

        {content.map((c, index) => (
          <div
            key={`${c.itemId}-${index}`}
            className="whitespace-pre-wrap text-sm text-foreground"
          >
            {c.text}
          </div>
        ))}

        {items.length === 0 && (
          <div className="flex h-32 items-center justify-center text-muted-foreground/50 text-sm">
            No timeline events
          </div>
        )}
      </div>
    </div>
  );
});

MessagesTimeline.displayName = "MessagesTimeline";
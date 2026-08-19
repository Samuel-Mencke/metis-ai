"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function formatThinkingDuration(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function ThinkingBlock({
  text,
  done = false,
  durationMs,
  embedded = false,
}: {
  text: string;
  done?: boolean;
  durationMs?: number;
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(!done);

  useEffect(() => {
    if (done) setExpanded(false);
  }, [done]);

  if (!text) return null;

  const durationLabel = formatThinkingDuration(durationMs);

  return (
    <div className={cn("w-full min-w-0", embedded ? "my-0.5" : "my-2")}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground",
          "transition-colors hover:bg-muted/20 hover:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground/60 transition-transform", expanded && "rotate-90")} />
        <span className="truncate font-medium text-muted-foreground">Thinking</span>
        {durationLabel ? (
          <span className="shrink-0 text-muted-foreground/70">· {durationLabel}</span>
        ) : !done ? (
          <span className="shrink-0 text-muted-foreground/60">…</span>
        ) : null}
      </button>
      {expanded ? (
        <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap pl-7 pr-1 text-sm italic leading-relaxed text-muted-foreground">
          {text}
        </div>
      ) : null}
    </div>
  );
}

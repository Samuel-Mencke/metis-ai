"use client";

import { useEffect, useState } from "react";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";

/** Same unobtrusive row as collapsed tool-call summaries. */
export const activityRowClass =
  "inline-flex max-w-full cursor-pointer items-center gap-1 appearance-none rounded-none border-0 bg-transparent p-0 text-left text-[11px] font-light text-muted-foreground/70 shadow-none ring-0 outline-none transition-colors hover:bg-transparent hover:text-muted-foreground focus-visible:ring-0";

export function formatThinkingDuration(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 10 && !Number.isInteger(s)) return `${s.toFixed(1)}s`;
  return `${Math.round(s)}s`;
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
  const title = done
    ? (durationLabel ? `Thought for ${durationLabel}` : "Thought")
    : (durationLabel ? `Thinking for ${durationLabel}` : "Thinking");

  return (
    <div className={cn("flex w-full min-w-0 flex-col", embedded ? "my-0" : "my-0.5")}>
      <div className="flex w-full min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={title}
          onClick={() => setExpanded((value) => !value)}
          className={cn(activityRowClass, "min-w-0 flex-1")}
        >
          <Brain className="size-3 shrink-0 opacity-70" />
          <span className="truncate">{title}</span>
          {!done && !durationLabel ? (
            <span className="shrink-0 text-muted-foreground/50">…</span>
          ) : null}
        </button>
      </div>
      {expanded ? (
        <div className="mt-0.5 max-h-48 overflow-y-auto whitespace-pre-wrap pl-4 text-[11px] font-light italic leading-relaxed text-muted-foreground/70">
          {text}
        </div>
      ) : null}
    </div>
  );
}

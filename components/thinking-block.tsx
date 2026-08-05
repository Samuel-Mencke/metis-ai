"use client";

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Markdown } from "@/components/markdown";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

function formatDuration(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function ThinkingBlock({
  text,
  done = false,
  durationMs,
}: {
  text: string;
  done?: boolean;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(!done);

  useEffect(() => {
    if (done) setOpen(false);
  }, [done]);

  if (!text) return null;

  const durationLabel = formatDuration(durationMs);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-2">
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center gap-1 rounded-md py-0.5 text-left",
          "text-[11px] font-light text-muted-foreground/70 transition-colors hover:text-muted-foreground",
        )}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span>Thinking</span>
        {durationLabel ? (
          <span className="text-muted-foreground/60">· {durationLabel}</span>
        ) : !done ? (
          <span className="text-muted-foreground/60">…</span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 pl-4 text-xs font-light leading-relaxed text-muted-foreground/70 sm:text-sm">
          <div className="[&_.markdown-body]:text-[inherit] [&_.markdown-body]:text-muted-foreground/70">
            <Markdown content={text} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

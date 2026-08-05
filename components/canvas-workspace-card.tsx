"use client";

import { ExternalLink, PanelRight } from "lucide-react";
import { Markdown } from "@/components/markdown";

export type CanvasWorkspaceCardProps = {
  title: string;
  content: string;
  onOpen?: () => void;
};

export function CanvasWorkspaceCard({
  title,
  content,
  onOpen,
}: CanvasWorkspaceCardProps) {
  return (
    <section className="my-3 w-full rounded-xl border border-border/60 bg-card/50 p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <PanelRight className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Canvas ready
          </p>
          <h3 className="truncate text-sm font-semibold text-foreground" title={title}>
            {title}
          </h3>
          <div className="mt-1 max-h-24 overflow-hidden text-xs text-muted-foreground">
            {content ? <Markdown content={content} /> : <p>No canvas details available yet.</p>}
          </div>
        </div>
        {onOpen ? (
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open canvas"
            title="Open canvas"
            onClick={onOpen}
          >
            <ExternalLink className="size-3.5" />
          </button>
        ) : null}
      </div>
      {onOpen ? (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={onOpen}
          >
            Open canvas
          </button>
        </div>
      ) : null}
    </section>
  );
}

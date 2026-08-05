"use client";

import { ClipboardList, ExternalLink } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

export type PlanWorkspaceCardProps = {
  title: string;
  content: string;
  onOpen?: () => void;
  onBuild?: () => void;
  buildDisabled?: boolean;
};

export function PlanWorkspaceCard({
  title,
  content,
  onOpen,
  onBuild,
  buildDisabled = false,
}: PlanWorkspaceCardProps) {
  return (
    <section className="my-3 w-full rounded-xl border border-blue-400/30 bg-blue-400/[0.07] p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-blue-400/15 text-blue-300">
          <ClipboardList className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-blue-300/80">
            Plan ready
          </p>
          <h3 className="truncate text-sm font-semibold text-foreground" title={title}>
            {title}
          </h3>
          <div className="mt-1 max-h-24 overflow-hidden text-xs text-muted-foreground">
            {content ? <Markdown content={content} /> : <p>No plan details available yet.</p>}
          </div>
        </div>
        {onOpen ? (
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Pop out plan"
            title="Pop out plan"
            onClick={onOpen}
          >
            <ExternalLink className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {onOpen ? (
          <button
            type="button"
            className="rounded-md border border-border/60 px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={onOpen}
          >
            Edit plan
          </button>
        ) : null}
        {onBuild ? (
          <button
            type="button"
            disabled={buildDisabled}
            className={cn(
              "rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            onClick={onBuild}
          >
            {buildDisabled ? "Agent running…" : "Build plan"}
          </button>
        ) : null}
      </div>
    </section>
  );
}

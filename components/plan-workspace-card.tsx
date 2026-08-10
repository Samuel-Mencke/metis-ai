"use client";

import { Check, ClipboardList, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

export type PlanWorkspaceCardProps = {
  title: string;
  content: string;
  workspaceLink?: string;
  onOpen?: () => void;
  onBuild?: () => void;
  buildDisabled?: boolean;
};

export function PlanWorkspaceCard({
  title,
  content,
  workspaceLink,
  onOpen,
  onBuild,
  buildDisabled = false,
}: PlanWorkspaceCardProps) {
  const [copied, setCopied] = useState(false);

  async function copyRawContent() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Raw plan content copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy plan content");
    }
  }

  return (
    <section className="my-2.5 w-full rounded-lg border border-border/50 border-l-blue-400/60 bg-muted/20 p-2.5">
      <div className="flex items-start gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-blue-400/10 text-blue-300">
          <ClipboardList className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-blue-300/80">
            Plan ready
          </p>
          <h3 className="truncate text-[13px] font-medium text-foreground" title={title}>
            {title}
          </h3>
          <div className="mt-0.5 max-h-20 overflow-hidden text-xs text-muted-foreground">
            {content ? <Markdown content={content} /> : <p>No plan details available yet.</p>}
          </div>
          {workspaceLink ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{workspaceLink}</p> : null}
        </div>
        {onOpen ? (
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Pop out plan"
            title="Pop out plan"
            onClick={onOpen}
          >
            <ExternalLink className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1">
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Copy raw plan content"
          title="Copy raw plan content"
          onClick={() => void copyRawContent()}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy raw"}
        </button>
        {onOpen ? (
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
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
              "rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90",
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

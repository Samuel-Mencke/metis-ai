"use client";

import { Check, Copy, ExternalLink, Palette } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";

export type CanvasWorkspaceCardProps = {
  title: string;
  content: string;
  workspaceLink?: string;
  onOpen?: () => void;
};

export function CanvasWorkspaceCard({
  title,
  content,
  workspaceLink,
  onOpen,
}: CanvasWorkspaceCardProps) {
  const [copied, setCopied] = useState(false);

  async function copyRawContent() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      toast.success("Raw canvas content copied");
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy canvas content");
    }
  }

  return (
    <section className="my-2.5 w-full rounded-lg border border-border/50 bg-muted/20 p-2.5">
      <div className="flex items-start gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Palette className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Canvas ready
          </p>
          <h3 className="truncate text-[13px] font-medium text-foreground" title={title}>
            {title}
          </h3>
          <div className="mt-0.5 max-h-20 overflow-hidden text-xs text-muted-foreground">
            {content ? <Markdown content={content} /> : <p>No canvas details available yet.</p>}
          </div>
          {workspaceLink ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70">{workspaceLink}</p> : null}
        </div>
        {onOpen ? (
          <button
            type="button"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open canvas"
            title="Open canvas"
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
          aria-label="Copy raw canvas content"
          title="Copy raw canvas content"
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
            Open canvas
          </button>
        ) : null}
      </div>
    </section>
  );
}

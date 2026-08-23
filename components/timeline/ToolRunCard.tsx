"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Terminal, CheckCircle2, AlertCircle, Loader2, Copy, Check } from "lucide-react";
import type { TimelineToolGroup } from "@/lib/runtime/timeline-reducer";

export function ToolRunCard({ group }: { group: TimelineToolGroup }) {
  const [isOpen, setIsOpen] = useState(group.status === "inProgress");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const isRunning = group.status === "inProgress";
  const isFailed = group.status === "failed";

  return (
    <div className="my-2 rounded-lg border border-border bg-card/60 overflow-hidden text-sm shadow-xs transition-all">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/40 hover:bg-muted/70 transition-colors text-left select-none cursor-pointer"
      >
        <div className="flex items-center gap-2 font-medium">
          {isOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          <Terminal className="w-4 h-4 text-primary" />
          <span>{group.summary}</span>
        </div>

        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1.5 text-xs text-amber-500 font-normal bg-amber-500/10 px-2 py-0.5 rounded-full">
              <Loader2 className="w-3 h-3 animate-spin" />
              Running...
            </span>
          )}
          {group.status === "completed" && (
            <span className="flex items-center gap-1.5 text-xs text-emerald-500 font-normal bg-emerald-500/10 px-2 py-0.5 rounded-full">
              <CheckCircle2 className="w-3 h-3" />
              Completed
            </span>
          )}
          {isFailed && (
            <span className="flex items-center gap-1.5 text-xs text-rose-500 font-normal bg-rose-500/10 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />
              Failed
            </span>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="divide-y divide-border/60 bg-background/50">
          {group.tools.map((tool) => {
            const rawOutput = tool.stdoutDelta || (tool.output ? (typeof tool.output === "string" ? tool.output : JSON.stringify(tool.output, null, 2)) : "");
            return (
              <div key={tool.id} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono text-xs text-foreground font-semibold">
                    <span className="text-primary">⚡ {tool.name}</span>
                  </div>
                  {rawOutput && (
                    <button
                      type="button"
                      onClick={() => handleCopy(tool.id, rawOutput)}
                      className="text-xs flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedId === tool.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedId === tool.id ? "Copied" : "Copy output"}
                    </button>
                  )}
                </div>

                {tool.input && (
                  <pre className="text-xs p-2 rounded-md bg-muted/50 overflow-x-auto text-muted-foreground font-mono">
                    {typeof tool.input === "string" ? tool.input : JSON.stringify(tool.input, null, 2)}
                  </pre>
                )}

                {rawOutput && (
                  <div className="mt-1 font-mono text-xs rounded-md bg-zinc-950 text-zinc-200 p-2.5 overflow-x-auto max-h-56 overflow-y-auto border border-zinc-800">
                    <pre className="whitespace-pre-wrap">{rawOutput}</pre>
                  </div>
                )}

                {tool.error && (
                  <div className="text-xs text-rose-400 bg-rose-950/40 p-2 rounded-md border border-rose-800/50">
                    {tool.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

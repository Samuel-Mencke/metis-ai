"use client";

import React, { useState } from "react";
import { FileCode, Plus, Minus, FileText } from "lucide-react";
import type { TimelineDiffItem } from "@/lib/runtime/timeline-reducer";

export function StyledDiffView({ item }: { item: TimelineDiffItem }) {
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const activeFile = item.files[selectedFileIdx] || item.files[0];

  if (!activeFile) return null;

  return (
    <div className="my-3 rounded-lg border border-border bg-card/70 overflow-hidden shadow-xs">
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <FileCode className="w-4 h-4 text-primary" />
          <span>File Changes ({item.files.length})</span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border">
        {item.files.length > 1 && (
          <div className="w-full md:w-64 bg-muted/20 p-2 space-y-1 overflow-y-auto max-h-60">
            {item.files.map((file, idx) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedFileIdx(idx)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-mono text-left transition-colors ${
                  idx === selectedFileIdx
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                <span className="truncate">{file.path}</span>
                <span className="text-[10px] uppercase font-bold opacity-80">{file.status}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 bg-zinc-950 text-zinc-200 p-3 font-mono text-xs overflow-x-auto max-h-96 overflow-y-auto">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800 text-zinc-400">
            <span className="font-semibold text-zinc-300">{activeFile.path}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 uppercase">
              {activeFile.status}
            </span>
          </div>

          <div className="space-y-0.5">
            {activeFile.diff.split(/\r?\n/).map((line, idx) => {
              const isAdd = line.startsWith("+") && !line.startsWith("+++");
              const isDel = line.startsWith("-") && !line.startsWith("---");
              const isHunk = line.startsWith("@@");

              return (
                <div
                  key={idx}
                  className={`flex items-start px-1.5 py-0.5 rounded-xs ${
                    isAdd
                      ? "bg-emerald-950/60 text-emerald-300"
                      : isDel
                        ? "bg-rose-950/60 text-rose-300"
                        : isHunk
                          ? "bg-sky-950/40 text-sky-400 font-bold"
                          : "text-zinc-300"
                  }`}
                >
                  <span className="w-5 shrink-0 text-zinc-600 select-none text-right pr-2">{idx + 1}</span>
                  <span className="w-4 shrink-0 text-center font-bold select-none">
                    {isAdd ? "+" : isDel ? "-" : " "}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line.slice(isAdd || isDel ? 1 : 0)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

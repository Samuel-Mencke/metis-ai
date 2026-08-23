"use client";

import React from "react";
import { Gauge } from "lucide-react";

export function ContextMeter({
  usage,
  maxContextTokens = 200_000,
}: {
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  maxContextTokens?: number;
}) {
  if (!usage || !usage.totalTokens) return null;

  const percentage = Math.min(100, Math.round((usage.totalTokens / maxContextTokens) * 100));

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-muted/40 border border-border text-[11px] text-muted-foreground select-none">
      <div className="flex items-center gap-1.5 font-medium">
        <Gauge className="w-3.5 h-3.5 text-primary" />
        <span>
          {usage.totalTokens.toLocaleString()} / {maxContextTokens.toLocaleString()} tokens ({percentage}%)
        </span>
      </div>

      <div className="w-16 bg-muted h-1 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${
            percentage > 85 ? "bg-rose-500" : percentage > 60 ? "bg-amber-500" : "bg-primary"
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

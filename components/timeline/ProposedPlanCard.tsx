"use client";

import React from "react";
import { ListTodo, CheckCircle2, Circle, Loader2 } from "lucide-react";
import type { TimelinePlanItem } from "@/lib/runtime/timeline-reducer";

export function ProposedPlanCard({ plan }: { plan: TimelinePlanItem }) {
  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const totalCount = plan.steps.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="my-3 rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3 shadow-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ListTodo className="w-4 h-4 text-primary" />
          <span>Execution Plan</span>
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {completedCount} / {totalCount} completed ({progressPercent}%)
        </span>
      </div>

      <div className="w-full bg-muted/60 h-1.5 rounded-full overflow-hidden">
        <div
          className="bg-primary h-full transition-all duration-300 rounded-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="space-y-2 pt-1">
        {plan.steps.map((step, idx) => {
          const isDone = step.status === "completed";
          const isProgress = step.status === "inProgress";

          return (
            <div
              key={step.id || idx}
              className={`flex items-start gap-2.5 p-2 rounded-md text-xs transition-colors ${
                isProgress
                  ? "bg-primary/10 border border-primary/20 text-foreground font-medium"
                  : isDone
                    ? "text-muted-foreground line-through opacity-80"
                    : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isDone && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                {isProgress && <Loader2 className="w-4 h-4 text-primary animate-spin" />}
                {!isDone && !isProgress && <Circle className="w-4 h-4 text-muted-foreground/50" />}
              </div>
              <span className="leading-relaxed">{step.title}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

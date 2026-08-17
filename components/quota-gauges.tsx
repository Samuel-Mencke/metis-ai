"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatResetAt,
  matchUsageProvider,
  percentLeft,
  selectPrimaryUsageWindow,
  windowsWithData,
  type UsageProvider,
  type UsageSnapshot,
} from "@/lib/usage-display";

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function thresholdColor(percentLeftValue: number) {
  if (percentLeftValue <= 10) return "text-red-400";
  if (percentLeftValue <= 25) return "text-amber-400";
  return "text-emerald-400";
}

function usedThresholdColor(usedPercent: number) {
  if (usedPercent >= 90) return "text-red-400";
  if (usedPercent >= 75) return "text-amber-400";
  return "text-emerald-400";
}

function usedBarColor(usedPercent: number) {
  if (usedPercent >= 90) return "bg-red-400";
  if (usedPercent >= 75) return "bg-amber-400";
  return "bg-emerald-400";
}

export function ContextUsageCircle({
  used,
  total,
  estimated,
  className,
}: {
  used: number;
  total: number;
  estimated?: boolean;
  className?: string;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const known = total > 0;
  const usedPercent = Math.min(100, Math.max(0, (used / Math.max(1, total)) * 100));
  const remaining = known ? Math.max(0, total - used) : null;
  const remainingPct = known ? percentLeft(usedPercent) : null;
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const color = known ? usedThresholdColor(usedPercent) : "text-muted-foreground";
  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn("group/context relative inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
            aria-label={
              known
                ? `Context: ${formatTokenCount(used)} of ${formatTokenCount(total)} tokens used`
                : `Context: ${formatTokenCount(used)} tokens used`
            }
            onClick={() => setTooltipOpen((open) => !open)}
          >
            <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-hidden="true">
              <circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/60" />
              <circle
                cx="12"
                cy="12"
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - (known ? usedPercent : 0) / 100)}
                className={cn("transition-[stroke-dashoffset,color] duration-500", color)}
              />
            </svg>
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          sideOffset={8}
          arrowClassName="!bg-popover !fill-popover"
          className="w-64 rounded-xl border border-border/60 bg-popover p-3 text-popover-foreground shadow-xl"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Context</span>
              {known && remainingPct !== null ? (
                <span className={cn("font-medium tabular-nums", color)}>{remainingPct.toFixed(0)}% left</span>
              ) : null}
            </div>
            {known ? (
              <>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
                  <div className={cn("h-full rounded-full transition-[width,background-color] duration-500", usedBarColor(usedPercent))} style={{ width: `${Math.min(100, usedPercent)}%` }} />
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span>Used</span><span className="text-right text-foreground tabular-nums">{formatTokenCount(used)} tokens{estimated ? " (est.)" : ""}</span>
                  <span>Maximum</span><span className="text-right text-foreground tabular-nums">{formatTokenCount(total)} tokens</span>
                  <span>Remaining</span><span className="text-right text-foreground tabular-nums">{formatTokenCount(remaining ?? 0)} tokens</span>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>Used</span>
                <span className="text-right text-foreground tabular-nums">{formatTokenCount(used)} tokens{estimated ? " (est.)" : ""}</span>
              </div>
            )}
            <p className="text-[10px] leading-snug text-muted-foreground">
              {estimated
                ? "Estimated from the current chat until the next model run reports tokens."
                : "Measured from the input tokens of the last model run."}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SemicircleGauge({ percentLeftValue, className }: { percentLeftValue: number; className?: string }) {
  const clamped = Math.min(100, Math.max(0, percentLeftValue));
  const radius = 10;
  const length = Math.PI * radius;
  return (
    <svg viewBox="0 0 24 14" className={cn("h-3.5 w-6", className)} aria-hidden="true">
      <path
        d="M 2 12 A 10 10 0 0 1 22 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        className="text-muted/60"
      />
      <path
        d="M 2 12 A 10 10 0 0 1 22 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={length}
        strokeDashoffset={length * (1 - clamped / 100)}
        className={cn("transition-[stroke-dashoffset,color] duration-500", thresholdColor(clamped))}
      />
    </svg>
  );
}

function UsageDetails({ provider }: { provider: UsageProvider }) {
  const primary = selectPrimaryUsageWindow(provider.windows);
  const usable = windowsWithData(provider.windows);
  const left = primary ? percentLeft(primary.usedPercent) : null;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">
          Usage
          {provider.planLabel ? (
            <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
              {provider.planLabel}
            </span>
          ) : null}
        </span>
        {left !== null ? (
          <span className={cn("font-medium tabular-nums", thresholdColor(left))}>{left.toFixed(0)}% left</span>
        ) : null}
      </div>
      {usable.map((window) => {
        const remaining = percentLeft(window.usedPercent);
        const reset = formatResetAt(window.resetsAt);
        return (
          <div key={`${provider.key}:${window.label}`} className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="capitalize">{window.label}</span>
              <span className="tabular-nums text-foreground">{remaining.toFixed(0)}% left</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
              <div
                className={cn("h-full rounded-full transition-[width,background-color] duration-500", usedBarColor(window.usedPercent))}
                style={{ width: `${Math.min(100, window.usedPercent)}%` }}
              />
            </div>
            {reset ? (
              <p className="text-[10px] text-muted-foreground">Resets in {reset}</p>
            ) : null}
          </div>
        );
      })}
      {provider.extra ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {Object.entries(provider.extra).map(([key, value]) =>
            value === null || value === undefined ? null : (
              <span key={key}>
                {key}: <span className="tabular-nums text-foreground">{typeof value === "number" ? value.toLocaleString() : value}</span>
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

export function PlanUsageGauge({
  provider,
  className,
}: {
  provider: UsageProvider;
  className?: string;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const primary = selectPrimaryUsageWindow(provider.windows);
  if (!primary) return null;
  const left = percentLeft(primary.usedPercent);
  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn("relative inline-flex h-7 w-7 shrink-0 items-end justify-center rounded-full pb-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}
            aria-label={`${provider.name} usage: ${left.toFixed(0)}% left`}
            onClick={() => setTooltipOpen((open) => !open)}
          >
            <SemicircleGauge percentLeftValue={left} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          sideOffset={8}
          arrowClassName="!bg-popover !fill-popover"
          className="w-64 rounded-xl border border-border/60 bg-popover p-3 text-popover-foreground shadow-xl"
        >
          <UsageDetails provider={provider} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PlanUsageCardGauge({ provider }: { provider: UsageProvider }) {
  const primary = selectPrimaryUsageWindow(provider.windows);
  if (!primary) return null;
  const left = percentLeft(primary.usedPercent);
  return (
    <div className="flex items-center gap-3">
      <SemicircleGauge percentLeftValue={left} className="h-5 w-9" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium tabular-nums", thresholdColor(left))}>{left.toFixed(0)}% left</p>
        <p className="text-[11px] capitalize text-muted-foreground">{primary.label}</p>
      </div>
    </div>
  );
}

let sharedSnapshot: UsageSnapshot | null = null;
const sharedListeners = new Set<(snapshot: UsageSnapshot | null) => void>();
let sharedTimer: ReturnType<typeof setInterval> | null = null;
let sharedInflight = false;

async function loadSharedPlanUsage(force = false) {
  if (sharedInflight && !force) return;
  sharedInflight = true;
  try {
    const res = await fetch(force ? "/api/plan-usage?refresh=1" : "/api/plan-usage", { cache: "no-store" });
    if (!res.ok) return;
    sharedSnapshot = (await res.json()) as UsageSnapshot;
    for (const listener of sharedListeners) listener(sharedSnapshot);
  } catch {
    /* keep last snapshot */
  } finally {
    sharedInflight = false;
  }
}

export function usePlanUsageSnapshot() {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(sharedSnapshot);

  useEffect(() => {
    sharedListeners.add(setSnapshot);
    if (!sharedTimer) {
      void loadSharedPlanUsage(false);
      sharedTimer = setInterval(() => void loadSharedPlanUsage(false), 120_000);
    } else if (sharedSnapshot) {
      setSnapshot(sharedSnapshot);
    } else {
      void loadSharedPlanUsage(false);
    }
    return () => {
      sharedListeners.delete(setSnapshot);
      if (sharedListeners.size === 0 && sharedTimer) {
        clearInterval(sharedTimer);
        sharedTimer = null;
      }
    };
  }, []);

  const refresh = useCallback(async (force = false) => {
    await loadSharedPlanUsage(force);
  }, []);

  return { snapshot, refresh };
}

export function usageForSelectedProvider(snapshot: UsageSnapshot | null, providerId?: string) {
  if (!snapshot) return null;
  return matchUsageProvider(snapshot.providers, providerId);
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  formatResetAt,
  lowQuotaAlerts,
  matchUsageProvider,
  percentLeft,
  selectPrimaryUsageWindow,
  windowsWithData,
  type UsageProvider,
  type UsageSelection,
  type UsageSnapshot,
} from "@/lib/usage-display";
import { CONTEXT_COMPACT_RATIO, CONTEXT_CRITICAL_RATIO, contextPressure, formatContextWindow } from "@/lib/context-window";

function formatTokenCount(value: number) {
  return formatContextWindow(value) || String(Math.round(value));
}

export type ContextBudgetState = "normal" | "unknown" | "stale" | "error" | "overflow" | "compacting";

export function contextBudgetState({
  used,
  effectiveInputBudget,
  measuredAt,
  error,
  compacting = false,
  now = Date.now(),
}: {
  used: number;
  effectiveInputBudget: number;
  measuredAt?: string;
  error?: string;
  compacting?: boolean;
  now?: number;
}): ContextBudgetState {
  if (error) return "error";
  if (!Number.isFinite(effectiveInputBudget) || effectiveInputBudget <= 0) return "unknown";
  if (contextPressure(used, effectiveInputBudget).overflow) return "overflow";
  if (compacting) return "compacting";
  if (measuredAt) {
    const measuredMs = Date.parse(measuredAt);
    if (Number.isFinite(measuredMs) && now - measuredMs > 15 * 60_000) return "stale";
  }
  return "normal";
}

function formatAge(value: string | undefined, now = Date.now()) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function contextStateLabel(state: ContextBudgetState) {
  return {
    normal: "Ready",
    unknown: "Unknown",
    stale: "Stale",
    error: "Error",
    overflow: "Overflow",
    compacting: "Compacting",
  }[state];
}

function thresholdColor(percentLeftValue: number) {
  if (percentLeftValue <= 10) return "text-red-400";
  if (percentLeftValue <= 25) return "text-amber-400";
  return "text-emerald-400";
}

function usedBarColor(usedPercent: number) {
  if (usedPercent >= CONTEXT_CRITICAL_RATIO * 100) return "bg-red-400";
  if (usedPercent >= CONTEXT_COMPACT_RATIO * 100) return "bg-amber-400";
  return "bg-emerald-400";
}

export function ContextUsageText({
  used,
  total,
  modelMaximum,
  estimated,
  measuredAt,
  source,
  selectionLabel,
  compacting,
  error,
  className,
}: {
  used: number;
  total: number;
  modelMaximum?: number;
  estimated?: boolean;
  measuredAt?: string;
  source?: string;
  selectionLabel?: string;
  compacting?: boolean;
  error?: string;
  className?: string;
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const pressure = contextPressure(used, total);
  const state = contextBudgetState({ used, effectiveInputBudget: total, measuredAt, error, compacting });
  const remaining = pressure.known ? Math.max(0, total - used) : null;
  const remainingPct = pressure.known ? percentLeft(pressure.usedPercent) : null;
  const label = pressure.known ? `${formatTokenCount(used)} / ${formatTokenCount(total)}` : `${formatTokenCount(used)} / —`;
  const freshness = estimated ? "current draft" : formatAge(measuredAt);
  const stateClass = state === "overflow" || state === "error" ? "text-red-400" : state === "compacting" ? "text-amber-400" : "text-muted-foreground/65";
  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <button type="button" className={cn("inline-flex h-7 shrink-0 items-center rounded-md px-1 text-[11px] font-medium tabular-nums tracking-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", pressure.critical ? "text-red-400" : `${stateClass} hover:text-muted-foreground`, className)} onClick={() => setTooltipOpen((open) => !open)} aria-label={pressure.known ? `Context: ${formatTokenCount(used)} of ${formatTokenCount(total)} effective input tokens used` : `Context: ${formatTokenCount(used)} tokens used; effective input budget unknown`}>
            {label}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" sideOffset={8} arrowClassName="!bg-popover !fill-popover" className="w-64 rounded-xl border border-border/60 bg-popover p-3 text-popover-foreground shadow-xl">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3"><span className="font-medium">Context budget</span><span className={cn("font-medium", stateClass)}>{contextStateLabel(state)}</span></div>
            {pressure.known ? <>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className={cn("h-full rounded-full transition-[width,background-color] duration-500", usedBarColor(pressure.usedPercent))} style={{ width: `${pressure.usedPercent}%` }} /></div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-muted-foreground"><span>Input used</span><span className="text-right text-foreground tabular-nums">{formatTokenCount(used)} tokens</span><span>Effective input</span><span className="text-right text-foreground tabular-nums">{formatTokenCount(total)} tokens</span><span>Model maximum</span><span className="text-right text-foreground tabular-nums">{modelMaximum ? `${formatTokenCount(modelMaximum)} tokens` : "—"}</span><span>Remaining</span><span className="text-right text-foreground tabular-nums">{formatTokenCount(remaining ?? 0)} tokens</span></div>
              {pressure.overflow ? <p className="text-[10px] leading-snug text-red-400">Reported usage exceeds this model&apos;s known maximum.</p> : pressure.compactRecommended ? <p className="text-[10px] leading-snug text-muted-foreground">Metis can compact managed history before the next run when context pressure is high.</p> : null}
            </> : null}
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] leading-snug text-muted-foreground"><span>Source: {source || (estimated ? "current chat estimate" : "last model run")}</span>{freshness ? <span>Freshness: {freshness}</span> : null}{selectionLabel ? <span>Selection: {selectionLabel}</span> : null}</div>
            {pressure.known ? <p className="text-[10px] leading-snug text-muted-foreground">{estimated ? "Estimated from the current chat until the next model run reports tokens." : "Measured from the input tokens of the last model run."} Managed-history compaction starts around {Math.round(CONTEXT_COMPACT_RATIO * 100)}%.</p> : <p className="text-[10px] leading-snug text-muted-foreground">Effective input budget is unknown; no percentage is shown.</p>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SemicircleGauge({ percentLeftValue, className }: { percentLeftValue: number | null; className?: string }) {
  const known = typeof percentLeftValue === "number" && Number.isFinite(percentLeftValue);
  const clamped = known ? Math.min(100, Math.max(0, percentLeftValue)) : 0;
  const radius = 10;
  const length = Math.PI * radius;
  return (
    <svg viewBox="0 0 24 14" className={cn("h-3.5 w-6", className)} aria-hidden="true">
      <path d="M 2 12 A 10 10 0 0 1 22 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-muted-foreground/35" />
      {known ? <path d="M 2 12 A 10 10 0 0 1 22 12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={length} strokeDashoffset={length * (1 - clamped / 100)} className={cn("transition-[stroke-dashoffset,color] duration-500", thresholdColor(clamped))} /> : null}
    </svg>
  );
}

function UsageDetails({ provider }: { provider: UsageProvider }) {
  const status = String(provider.status);
  const usable = status === "live" || status === "stale" ? windowsWithData(provider.windows) : [];
  const primary = selectPrimaryUsageWindow(usable);
  const left = primary ? percentLeft(primary.usedPercent) : null;
  const statusLabel = status === "stale"
    ? "Stale"
    : status === "error"
      ? "Error"
      : status === "no_auth"
        ? "Not connected"
        : status === "unsupported"
          ? "Unsupported"
          : "Live";
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="truncate font-medium">{provider.name}</p><p className="text-[10px] text-muted-foreground">Quota · {statusLabel}{provider.planLabel ? ` · ${provider.planLabel}` : ""}</p></div>
        {left !== null ? <span className={cn("shrink-0 font-medium tabular-nums", status === "stale" ? "text-muted-foreground" : thresholdColor(left))}>{left.toFixed(0)}% left</span> : <span className="shrink-0 text-[10px] text-muted-foreground">—</span>}
      </div>
      {usable.map((window) => {
        const remaining = percentLeft(window.usedPercent);
        const reset = formatResetAt(window.resetsAt);
        return <div key={`${provider.key}:${window.label}`} className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span className="capitalize">{window.label}</span><span className="tabular-nums text-foreground">{remaining.toFixed(0)}% left</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/15"><div className={cn("h-full rounded-full transition-[width,background-color] duration-500", usedBarColor(window.usedPercent))} style={{ width: `${Math.min(100, window.usedPercent)}%` }} /></div>
          {reset ? <p className="text-[10px] text-muted-foreground">Resets in {reset}</p> : null}
        </div>;
      })}
      {!usable.length ? <p className="text-[10px] leading-snug text-muted-foreground">{status === "no_auth" ? "No authenticated quota source is connected." : status === "unsupported" ? "This connection does not expose a quota window." : provider.error ? `Live quota could not be loaded: ${provider.error}` : "No percentage quota is available. Metis will not invent one."}</p> : null}
      {provider.extra ? <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{Object.entries(provider.extra).map(([key, value]) => value === null || value === undefined ? null : <span key={key}>{key === "planUsed" ? "Plan used" : key === "planLimit" ? "Plan limit" : key === "onDemandUsed" ? "Credits used" : key}: <span className="tabular-nums text-foreground">{typeof value === "number" ? value.toLocaleString() : value}</span></span>)}</div> : null}
    </div>
  );
}

export function PlanUsageGauge({ provider, providerName, className }: { provider?: UsageProvider | null; providerName?: string; className?: string }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const primary = provider ? selectPrimaryUsageWindow(provider.windows) : null;
  const left = primary ? percentLeft(primary.usedPercent) : null;
  const displayName = provider?.name || providerName || "Selected provider";
  return (
    <TooltipProvider>
      <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <button type="button" className={cn("relative inline-flex h-7 w-7 shrink-0 items-end justify-center rounded-full pb-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} aria-label={left !== null ? `${displayName} usage: ${left.toFixed(0)}% left` : `${displayName} usage unavailable`} onClick={() => setTooltipOpen((open) => !open)}>
            <SemicircleGauge percentLeftValue={left} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" sideOffset={8} arrowClassName="!bg-popover !fill-popover" className="w-64 rounded-xl border border-border/60 bg-popover p-3 text-popover-foreground shadow-xl">
          {provider ? <UsageDetails provider={provider} /> : <div className="space-y-1.5"><p className="font-medium">{displayName}</p><p className="text-[10px] leading-snug text-muted-foreground">No live percentage quota is available for this connection. Metis will not invent a usage value.</p></div>}
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

export function PlanUsagePanel({
  snapshot,
  onRefresh,
}: {
  snapshot: UsageSnapshot | null;
  onRefresh?: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Provider usage</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Only provider-reported quota windows are shown. Missing data stays neutral.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={!onRefresh || refreshing}
        >
          <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>
      {lowQuotaAlerts(snapshot).length ? (
        <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-200">
          {lowQuotaAlerts(snapshot).map((alert) => (
            <p key={`${alert.providerKey}:${alert.windowLabel}`}>
              {alert.providerName}: {alert.remainingPct.toFixed(0)}% left on {alert.windowLabel}
              {alert.resetsAt ? ` · resets in ${formatResetAt(alert.resetsAt) || "pending"}` : ""}.
            </p>
          ))}
        </div>
      ) : null}
      {!snapshot ? (
        <div className="rounded-lg border border-border/60 p-4 text-xs text-muted-foreground">
          Usage has not been loaded yet.
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3">
          {snapshot.providers
              .filter((provider) => provider.source === "dashboard" || ["cursor", "codex", "zai", "antigravity"].includes(provider.key))
              .map((provider) => (
            <div key={provider.key} className="min-w-0 overflow-hidden rounded-lg border border-border/60 p-4">
              <UsageDetails provider={provider} />
            </div>
          ))}
        </div>
      )}
      {snapshot ? <p className="text-[10px] text-muted-foreground">Fetched {formatAge(snapshot.fetchedAt) || "recently"}.</p> : null}
    </section>
  );
}

let sharedSnapshot: UsageSnapshot | null = null;
const sharedListeners = new Set<(snapshot: UsageSnapshot | null) => void>();
let sharedTimer: ReturnType<typeof setInterval> | null = null;
let sharedInflight = 0;
let sharedLoadVersion = 0;

async function loadSharedPlanUsage(force = false) {
  if (sharedInflight > 0 && !force) return;
  const version = ++sharedLoadVersion;
  sharedInflight += 1;
  try {
    const res = await fetch(force ? "/api/plan-usage?refresh=1" : "/api/plan-usage", { cache: "no-store" });
    if (!res.ok) return;
    const nextSnapshot = (await res.json()) as UsageSnapshot;
    if (version !== sharedLoadVersion) return;
    sharedSnapshot = nextSnapshot;
    for (const listener of sharedListeners) listener(sharedSnapshot);
  } catch {
    /* keep last snapshot */
  } finally {
    sharedInflight -= 1;
  }
}

export function usePlanUsageSnapshot(enabled = true) {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(sharedSnapshot);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !snapshot) return;
    const day = new Date().toISOString().slice(0, 10);
    for (const alert of lowQuotaAlerts(snapshot)) {
      const id = `metis-quota-alert:${alert.providerKey}:${alert.windowLabel}:${day}`;
      try {
        if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(id)) continue;
        sessionStorage?.setItem(id, "1");
      } catch {
        /* private mode / SSR */
      }
      const reset = formatResetAt(alert.resetsAt);
      toast.warning(`${alert.providerName} quota is low`, {
        description: `${alert.remainingPct.toFixed(0)}% left on ${alert.windowLabel}${reset ? ` · resets in ${reset}` : ""}`,
      });
    }
  }, [enabled, snapshot]);

  const refresh = useCallback(async (force = false) => {
    await loadSharedPlanUsage(force);
  }, []);

  return { snapshot, refresh };
}

export function usageForSelectedProvider(
  snapshot: UsageSnapshot | null,
  selection?: string | UsageSelection | null,
) {
  if (!snapshot) return null;
  return matchUsageProvider(snapshot.providers, selection);
}

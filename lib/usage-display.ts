export type UsageWindow = {
  label: string;
  usedPercent: number | null;
  resetsAt: string | null;
};

export type UsageProvider = {
  key: string;
  name: string;
  status: "live" | "stale" | "error" | "no_auth";
  planLabel?: string;
  windows: UsageWindow[];
  extra?: Record<string, string | number | null>;
  error?: string;
};

export type UsageSnapshot = {
  providers: UsageProvider[];
  fetchedAt: string;
};

const WEEKLY = /week/i;
const SHORT_WINDOW = /^(\d+h|5h|hours?)$/i;
const MONTHLY = /month|cycle|included|total|plan/i;

export function usageKeyForProvider(providerId?: string | null): string | null {
  const key = (providerId || "").trim().toLowerCase();
  if (!key) return null;
  if (key === "cursor" || key === "cursor-agent") return "cursor";
  if (key === "codex") return "codex";
  if (key === "antigravity") return "antigravity";
  if (key === "zai" || key === "z.ai" || key === "z-ai" || key === "glm") return "zai";
  return null;
}

export function windowsWithData(windows: UsageWindow[]): Array<UsageWindow & { usedPercent: number }> {
  return windows.filter(
    (window): window is UsageWindow & { usedPercent: number } =>
      typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent),
  );
}

export function selectPrimaryUsageWindow(windows: UsageWindow[]): (UsageWindow & { usedPercent: number }) | null {
  const usable = windowsWithData(windows);
  if (!usable.length) return null;
  return (
    usable.find((window) => WEEKLY.test(window.label)) ||
    usable.find((window) => SHORT_WINDOW.test(window.label)) ||
    usable.find((window) => MONTHLY.test(window.label)) ||
    usable[0]
  );
}

export function percentLeft(usedPercent: number): number {
  return Math.min(100, Math.max(0, 100 - usedPercent));
}

export function formatResetAt(resetsAt: string | null | undefined): string | null {
  if (!resetsAt) return null;
  const ms = Date.parse(resetsAt);
  if (!Number.isFinite(ms)) return null;
  const diff = ms - Date.now();
  if (diff <= 0) return "reset pending";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function parseCursorUsageBody(body: unknown): {
  windows: UsageWindow[];
  planLabel?: string;
  extra?: Record<string, string | number | null>;
} | null {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!root) return null;
  const asRecord = (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const asFinitePercent = (value: unknown) => {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.min(100, Math.max(0, n)));
  };
  const individual = asRecord(root.individualUsage);
  const plan = asRecord(individual?.plan) || asRecord(root.planUsage) || asRecord(root.plan);
  const onDemand = asRecord(individual?.onDemand) || asRecord(root.onDemand);
  const membership = typeof root.membershipType === "string" ? root.membershipType : undefined;
  let resetsAt: string | null = typeof root.billingCycleEnd === "string" ? root.billingCycleEnd : null;
  if (!resetsAt) {
    const n = typeof root.billingCycleEnd === "number" ? root.billingCycleEnd : Number(root.billingCycleEnd);
    if (Number.isFinite(n) && n > 0) {
      resetsAt = new Date(n > 1e12 ? n : n * 1000).toISOString();
    }
  }
  const windows: UsageWindow[] = [];
  const push = (label: string, usedPercent: number | null) => {
    if (usedPercent === null) return;
    windows.push({ label, usedPercent, resetsAt });
  };
  if (plan) {
    push("monthly", asFinitePercent(plan.totalPercentUsed));
    push("auto", asFinitePercent(plan.autoPercentUsed));
    push("api", asFinitePercent(plan.apiPercentUsed));
    if (!windows.length) {
      const used = typeof plan.used === "number" ? plan.used : null;
      const limit = typeof plan.limit === "number" ? plan.limit : null;
      if (used !== null && limit && limit > 0) {
        push("monthly", Math.round((used / limit) * 100));
      }
    }
  }
  if (onDemand && typeof onDemand.used === "number" && typeof onDemand.limit === "number" && onDemand.limit > 0) {
    push("on-demand", Math.round((onDemand.used / onDemand.limit) * 100));
  }
  if (!windows.length) return null;
  const extra: Record<string, string | number | null> = {};
  if (typeof plan?.used === "number") extra.planUsed = plan.used;
  if (typeof plan?.limit === "number") extra.planLimit = plan.limit;
  if (typeof onDemand?.used === "number") extra.onDemandUsed = onDemand.used;
  return {
    windows,
    planLabel: membership ? membership.charAt(0).toUpperCase() + membership.slice(1) : undefined,
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

export function matchUsageProvider(
  providers: UsageProvider[],
  providerId?: string | null,
): UsageProvider | null {
  const key = usageKeyForProvider(providerId);
  if (!key) return null;
  const found = providers.find((provider) => provider.key === key);
  if (!found) return null;
  if (found.status === "error" || found.status === "no_auth") return null;
  if (!selectPrimaryUsageWindow(found.windows)) return null;
  return found;
}

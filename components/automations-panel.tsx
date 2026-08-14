"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, Clock3, Pause, Pencil, Play, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ModelInfo } from "@/components/settings-panel";
import type { AgentMode } from "@/lib/store";

type AutomationRun = {
  id: string;
  chatId: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  resultPreview?: string;
  error?: string;
};

type Automation = {
  id: string;
  chatId: string;
  chatTitle?: string;
  name: string;
  prompt: string;
  modeId?: string;
  modelId?: string;
  extendedModelId?: string;
  schedule:
    | { kind: "once"; at: string }
    | { kind: "interval"; everyMinutes: number }
    | { kind: "days"; everyDays: number }
    | { kind: "monthly"; dayOfMonth: number };
  timezone: string;
  status: string;
  nextRunAt?: string;
  lastError?: string;
  runs?: AutomationRun[];
};

type AutomationsPanelProps = {
  activeChatId?: string | null;
  onOpenChat: (chatId: string) => void;
  models: ModelInfo[];
  modes: AgentMode[];
  selectedModelId?: string;
};

function dateText(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function scheduleText(automation: Automation) {
  if (automation.schedule.kind === "once") return `Once · ${dateText(automation.schedule.at)}`;
  if (automation.schedule.kind === "days") return `Every ${automation.schedule.everyDays} day${automation.schedule.everyDays === 1 ? "" : "s"}`;
  if (automation.schedule.kind === "monthly") return `Monthly · day ${automation.schedule.dayOfMonth}`;
  return `Every ${automation.schedule.everyMinutes} minutes`;
}

export function AutomationsPanel({ activeChatId, onOpenChat, models, modes, selectedModelId }: AutomationsPanelProps) {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Automation | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleKind, setScheduleKind] = useState<"once" | "interval" | "days" | "monthly">("interval");
  const [onceAt, setOnceAt] = useState("");
  const [everyMinutes, setEveryMinutes] = useState("60");
  const [everyDays, setEveryDays] = useState("1");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [chatId, setChatId] = useState(activeChatId || "");
  const [modeId, setModeId] = useState("agent");
  const [modelId, setModelId] = useState(selectedModelId || "");
  const [extendedModelId, setExtendedModelId] = useState("");

  const load = async (silent = false) => {
    try {
      const response = await fetch("/api/automations", { cache: "no-store" });
      const data = (await response.json()) as { automations?: Automation[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load automations");
      setAutomations(data.automations || []);
    } catch (error) {
      if (!silent) toast.error(error instanceof Error ? error.message : "Could not load automations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const latestCompleted = useMemo(
    () => automations.flatMap((automation) => (automation.runs || []).map((run) => ({ automation, run })))
      .filter(({ run }) => run.status === "completed")
      .sort((a, b) => Date.parse(b.run.completedAt || b.run.createdAt) - Date.parse(a.run.completedAt || a.run.createdAt))[0],
    [automations],
  );

  useEffect(() => {
    if (!latestCompleted || !latestCompleted.run.completedAt) return;
    const key = `automation-notified:${latestCompleted.run.id}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    toast.success(`Automation completed: ${latestCompleted.automation.name}`, {
      description: latestCompleted.automation.chatTitle || "Open the linked chat to view the result.",
    });
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Automation completed: ${latestCompleted.automation.name}`, {
        body: latestCompleted.automation.chatTitle || "Your scheduled task has completed.",
      });
    }
  }, [latestCompleted]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setPrompt("");
    setScheduleKind("interval");
    setOnceAt("");
    setEveryMinutes("60");
    setEveryDays("1");
    setDayOfMonth("1");
    setChatId(activeChatId || "");
    setModeId(modes[0]?.id || "agent");
    setModelId(selectedModelId || models[0]?.id || "");
    setExtendedModelId("");
    setFormOpen(false);
  }

  function editAutomation(automation: Automation) {
    setFormOpen(true);
    setEditingId(automation.id);
    setName(automation.name);
    setPrompt(automation.prompt);
    setChatId(automation.chatId);
    setModeId(automation.modeId || modes[0]?.id || "agent");
    setModelId(automation.modelId || selectedModelId || models[0]?.id || "");
    setExtendedModelId(automation.extendedModelId || "");
    if (automation.schedule.kind === "once") {
      setScheduleKind("once");
      setOnceAt(automation.schedule.at.slice(0, 16));
    } else if (automation.schedule.kind === "days") {
      setScheduleKind("days");
      setEveryDays(String(automation.schedule.everyDays));
    } else if (automation.schedule.kind === "monthly") {
      setScheduleKind("monthly");
      setDayOfMonth(String(automation.schedule.dayOfMonth));
    } else {
      setScheduleKind("interval");
      setEveryMinutes(String(automation.schedule.everyMinutes));
    }
  }

  async function saveAutomation(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const schedule = scheduleKind === "once"
        ? { kind: "once", at: new Date(onceAt).toISOString() }
        : scheduleKind === "days"
          ? { kind: "days", everyDays: Number(everyDays) }
          : scheduleKind === "monthly"
            ? { kind: "monthly", dayOfMonth: Number(dayOfMonth) }
            : { kind: "interval", everyMinutes: Number(everyMinutes) };
      const response = await fetch(editingId ? `/api/automations/${editingId}` : "/api/automations", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          prompt,
          chatId: chatId || activeChatId,
          modeId,
          modelId,
          extendedModelId: extendedModelId || undefined,
          schedule,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save automation");
      toast.success(editingId ? "Automation updated" : "Automation created");
      resetForm();
      await load(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save automation");
    } finally {
      setSaving(false);
    }
  }

  async function action(id: string, method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
    const response = await fetch(`/api/automations/${id}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error || "Automation action failed");
    await load(true);
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
      <div className="flex items-center justify-between rounded-lg border border-border/40 bg-card/50 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-medium"><CalendarClock className="size-4 text-primary" />Automations</span>
        <Button type="button" size="icon-xs" variant="ghost" title="New automation" onClick={() => { resetForm(); setFormOpen(true); }}>
          <Plus className="size-4" />
        </Button>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit automation" : "New automation"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveAutomation} className="space-y-3">
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Automation name" required />
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What should the agent do?" className="min-h-24" required />
            <Input value={chatId} onChange={(event) => setChatId(event.target.value)} placeholder={activeChatId ? "Current chat will be used" : "Target chat ID"} className="font-mono text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <select value={modeId} onChange={(event) => setModeId(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs" aria-label="AI mode">
                {modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
              </select>
              <select value={modelId} onChange={(event) => setModelId(event.target.value)} className="h-9 min-w-0 rounded-md border bg-background px-2 text-xs" aria-label="Model">
                <option value="">Select model</option>
                {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
              </select>
            </div>
            <select value={extendedModelId} onChange={(event) => setExtendedModelId(event.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-xs" aria-label="Extended model">
              <option value="">Default extended model</option>
              {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select value={scheduleKind} onChange={(event) => setScheduleKind(event.target.value as "once" | "interval" | "days" | "monthly")} className="h-9 rounded-md border bg-background px-2 text-xs">
                <option value="interval">Every X minutes</option>
                <option value="days">Every X days</option>
                <option value="monthly">Monthly day</option>
                <option value="once">One-time</option>
              </select>
              {scheduleKind === "once" ? (
                <Input type="datetime-local" value={onceAt} onChange={(event) => setOnceAt(event.target.value)} className="h-9 text-xs" required />
              ) : scheduleKind === "days" ? (
                <Input type="number" min="1" step="1" value={everyDays} onChange={(event) => setEveryDays(event.target.value)} className="h-9 text-xs" placeholder="Days" required />
              ) : scheduleKind === "monthly" ? (
                <Input type="number" min="1" max="31" step="1" value={dayOfMonth} onChange={(event) => setDayOfMonth(event.target.value)} className="h-9 text-xs" placeholder="Day 1–31" required />
              ) : (
                <Input type="number" min="60" step="1" value={everyMinutes} onChange={(event) => setEveryMinutes(event.target.value)} className="h-9 text-xs" required />
              )}
            </div>
            <Button type="submit" className="w-full" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Create automation"}</Button>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete automation?"
        description={deleteTarget ? `“${deleteTarget.name}” and its run history will be deleted permanently.` : ""}
        confirmLabel="Delete automation"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await action(deleteTarget.id, "DELETE");
          setDeleteTarget(null);
        }}
      />

      {loading ? <p className="p-3 text-xs text-muted-foreground">Loading automations…</p> : null}
      {!loading && automations.length === 0 ? <p className="p-3 text-xs text-muted-foreground">No automations yet.</p> : null}
      {automations.map((automation) => (
        <section key={automation.id} className="space-y-2 rounded-lg border border-border/40 bg-card/40 p-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs font-medium">
                {automation.status === "active" ? <Clock3 className="size-3.5 text-emerald-400" /> : automation.status === "error" ? <XCircle className="size-3.5 text-destructive" /> : <Pause className="size-3.5 text-muted-foreground" />}
                <span className="truncate">{automation.name}</span>
                <span className="text-[10px] text-muted-foreground">{automation.status}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{automation.prompt}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button type="button" size="icon-xs" variant="ghost" title="Edit" onClick={() => editAutomation(automation)}><Pencil className="size-3" /></Button>
              {automation.status === "active" ? (
                <Button type="button" size="icon-xs" variant="ghost" title="Pause" onClick={() => void action(automation.id, "PATCH", { action: "pause" })}><Pause className="size-3" /></Button>
              ) : (
                <Button type="button" size="icon-xs" variant="ghost" title="Resume" onClick={() => void action(automation.id, "PATCH", { action: "resume" })}><Play className="size-3" /></Button>
              )}
              <Button type="button" size="icon-xs" variant="ghost" title="Delete" onClick={() => setDeleteTarget(automation)}><Trash2 className="size-3 text-destructive" /></Button>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">{scheduleText(automation)} · next {dateText(automation.nextRunAt)}</div>
          {automation.lastError ? <p className="rounded border border-destructive/20 bg-destructive/10 p-2 text-[10px] text-destructive">{automation.lastError}</p> : null}
          <button type="button" className="flex w-full items-center gap-2 rounded border border-border/40 px-2 py-1.5 text-left text-[11px] hover:bg-muted/40" onClick={() => onOpenChat(automation.chatId)}>
            <CheckCircle2 className="size-3.5 text-primary" />
            <span className="min-w-0 flex-1 truncate">{automation.chatTitle || automation.chatId}</span>
            <span className="text-[10px] text-muted-foreground">Target chat</span>
          </button>
          {(automation.runs || []).length ? (
            <div className="space-y-1 border-t border-border/30 pt-2">
              <p className="text-[10px] font-medium text-muted-foreground">Runs in the target chat</p>
              {(automation.runs || []).map((run) => (
                <button key={run.id} type="button" className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[10px] hover:bg-muted/40" onClick={() => onOpenChat(run.chatId)}>
                  <span className={run.status === "completed" ? "text-emerald-400" : run.status === "error" ? "text-destructive" : "text-amber-400"}>●</span>
                  <span className="min-w-0 flex-1 truncate">{dateText(run.completedAt || run.createdAt)}</span>
                  <span className="text-muted-foreground">{run.status}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

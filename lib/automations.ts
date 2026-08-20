import { randomUUID } from "node:crypto";
import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import { appendMessage, createChat, getChat, updateChat } from "@/lib/db-store";
import { enqueueJob, getJob } from "@/lib/db-jobs";

export const MAX_ACTIVE_AUTOMATIONS = 20;
export const MIN_AUTOMATION_INTERVAL_MINUTES = 60;

export type AutomationStatus = "active" | "paused" | "completed" | "error";
export type AutomationSchedule =
  | { kind: "once"; at: string }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "days"; everyDays: number }
  | { kind: "monthly"; dayOfMonth: number };

export type Automation = {
  id: string;
  ownerId: string;
  chatId: string;
  chatTitle?: string;
  name: string;
  prompt: string;
  modeId?: string;
  modelId?: string;
  extendedModelId?: string;
  schedule: AutomationSchedule;
  timezone: string;
  status: AutomationStatus;
  nextRunAt?: string;
  lastRunAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  runs?: AutomationRun[];
};

export type AutomationRun = {
  id: string;
  automationId: string;
  jobId?: string;
  chatId: string;
  status: "queued" | "running" | "completed" | "error" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  resultPreview?: string;
  error?: string;
  createdAt: string;
  manual?: boolean;
};

type AutomationRow = {
  id: string;
  owner_id: string;
  chat_id: string;
  chat_title?: string;
  name: string;
  prompt: string;
  mode_id: string | null;
  model_id: string | null;
  extended_model_id: string | null;
  schedule_kind: "once" | "interval";
  schedule_value: string;
  timezone: string;
  status: AutomationStatus;
  next_run_at: string | null;
  last_run_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function iso() {
  return new Date().toISOString();
}

function rowToAutomation(row: AutomationRow): Automation {
  const schedule = scheduleFromStorage(row.schedule_kind, row.schedule_value);
  return {
    id: row.id,
    ownerId: row.owner_id,
    chatId: row.chat_id,
    ...(row.chat_title ? { chatTitle: row.chat_title } : {}),
    name: row.name,
    prompt: row.prompt,
    ...(row.mode_id ? { modeId: row.mode_id } : {}),
    ...(row.model_id ? { modelId: row.model_id } : {}),
    ...(row.extended_model_id ? { extendedModelId: row.extended_model_id } : {}),
    schedule,
    timezone: row.timezone,
    status: row.status,
    ...(row.next_run_at ? { nextRunAt: row.next_run_at } : {}),
    ...(row.last_run_at ? { lastRunAt: row.last_run_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduleFromStorage(kind: AutomationRow["schedule_kind"], value: string): AutomationSchedule {
  if (kind === "once") return { kind: "once", at: value };
  if (value.startsWith("days:")) return { kind: "days", everyDays: Number(value.slice(5)) };
  if (value.startsWith("monthly:")) return { kind: "monthly", dayOfMonth: Number(value.slice(8)) };
  return { kind: "interval", everyMinutes: Number(value) };
}

function scheduleStorage(schedule: AutomationSchedule): { kind: "once" | "interval"; value: string } {
  if (schedule.kind === "once") return { kind: "once", value: schedule.at };
  if (schedule.kind === "days") return { kind: "interval", value: `days:${schedule.everyDays}` };
  if (schedule.kind === "monthly") return { kind: "interval", value: `monthly:${schedule.dayOfMonth}` };
  return { kind: "interval", value: String(schedule.everyMinutes) };
}

function listRuns(automationId: string, ownerId: string, limit = 20): AutomationRun[] {
  const rows = getDatabase().prepare(
    `SELECT r.id, r.automation_id as automationId, r.job_id as jobId, r.chat_id as chatId,
            r.status, r.started_at as startedAt, r.completed_at as completedAt,
            r.result_preview as resultPreview, r.error, r.created_at as createdAt,
            r.manual as manual
     FROM automation_runs r
     JOIN automations a ON a.id = r.automation_id
     WHERE r.automation_id = ? AND a.owner_id = ?
     ORDER BY r.created_at DESC LIMIT ?`,
  ).all(automationId, ownerId, Math.max(1, Math.min(limit, 100))) as unknown as Array<AutomationRun & { manual?: number | boolean }>;
  return rows.map((run) => {
    const { manual: manualFlag, ...rest } = run;
    return {
      ...rest,
      ...(rest.jobId ? { jobId: String(rest.jobId) } : {}),
      ...(rest.resultPreview ? { resultPreview: String(rest.resultPreview) } : {}),
      ...(rest.error ? { error: String(rest.error) } : {}),
      ...(Number(manualFlag) === 1 ? { manual: true } : {}),
    };
  });
}

function validateSchedule(schedule: AutomationSchedule): AutomationSchedule {
  if (schedule.kind === "once") {
    const at = new Date(schedule.at);
    if (!Number.isFinite(at.getTime())) throw new Error("Invalid one-time schedule.");
    if (at.getTime() <= Date.now()) throw new Error("The scheduled time must be in the future.");
    return { kind: "once", at: at.toISOString() };
  }
  if (schedule.kind === "days") {
    const everyDays = Math.floor(Number(schedule.everyDays));
    if (!Number.isFinite(everyDays) || everyDays < 1) throw new Error("The day interval must be at least 1 day.");
    return { kind: "days", everyDays: Math.min(everyDays, 3650) };
  }
  if (schedule.kind === "monthly") {
    const dayOfMonth = Math.floor(Number(schedule.dayOfMonth));
    if (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      throw new Error("The day of the month must be between 1 and 31.");
    }
    return { kind: "monthly", dayOfMonth };
  }
  const everyMinutes = Math.floor(Number(schedule.everyMinutes));
  if (!Number.isFinite(everyMinutes) || everyMinutes < MIN_AUTOMATION_INTERVAL_MINUTES) {
    throw new Error(`Recurring automations must run at least every ${MIN_AUTOMATION_INTERVAL_MINUTES} minutes.`);
  }
  return { kind: "interval", everyMinutes: Math.min(everyMinutes, 365 * 24 * 60) };
}

function nextRunFor(schedule: AutomationSchedule, from = Date.now()) {
  if (schedule.kind === "once") return schedule.at;
  if (schedule.kind === "interval") return new Date(from + schedule.everyMinutes * 60_000).toISOString();
  if (schedule.kind === "days") return new Date(from + schedule.everyDays * 24 * 60 * 60_000).toISOString();
  const current = new Date(from);
  const targetDay = schedule.dayOfMonth;
  const candidate = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), targetDay, 0, 0, 0, 0));
  if (candidate.getTime() <= from) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1, targetDay);
  }
  // Dates such as the 31st run on the last day in shorter months.
  if (candidate.getUTCDate() !== targetDay) {
    candidate.setUTCDate(0);
  }
  return candidate.toISOString();
}

function activeCount(ownerId: string) {
  return Number((getDatabase().prepare(
    "SELECT COUNT(*) as count FROM automations WHERE owner_id = ? AND status = 'active'",
  ).get(ownerId) as { count?: number }).count || 0);
}

export function createAutomation(input: {
  ownerId: string;
  chatId?: string;
  name: string;
  prompt: string;
  modeId?: string;
  modelId?: string;
  extendedModelId?: string;
  schedule: AutomationSchedule;
  timezone?: string;
}) {
  const name = input.name.trim().slice(0, 200);
  const prompt = input.prompt.trim().slice(0, 100_000);
  if (!name || !prompt) throw new Error("Automation name and prompt are required.");
  const schedule = validateSchedule(input.schedule);
  if (activeCount(input.ownerId) >= MAX_ACTIVE_AUTOMATIONS) {
    throw new Error(`Maximum ${MAX_ACTIVE_AUTOMATIONS} active automations reached.`);
  }
  const chat = input.chatId ? getChat(input.chatId, input.ownerId) : createChat(name, undefined, input.ownerId);
  if (!chat || chat.incognito) throw new Error("A valid non-incognito target chat is required.");
  const now = iso();
  const id = randomUUID();
  const storedSchedule = scheduleStorage(schedule);
  getDatabase().prepare(
    `INSERT INTO automations
      (id, owner_id, chat_id, name, prompt, mode_id, model_id, extended_model_id,
       schedule_kind, schedule_value, timezone, status, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).run(
    id,
    input.ownerId,
    chat.id,
    name,
    prompt,
    input.modeId?.trim().slice(0, 100) || null,
    input.modelId?.trim().slice(0, 300) || null,
    input.extendedModelId?.trim().slice(0, 300) || null,
    storedSchedule.kind,
    storedSchedule.value,
    input.timezone?.trim().slice(0, 80) || "UTC",
    schedule.kind === "once" ? schedule.at : nextRunFor(schedule),
    now,
    now,
  );
  return getAutomation(id, input.ownerId)!;
}

export function getAutomation(id: string, ownerId: string, includeRuns = true): Automation | null {
  const row = getDatabase().prepare(
    `SELECT a.*, c.data ->> '$.title' as chat_title
     FROM automations a
     LEFT JOIN chats c ON c.id = a.chat_id
     WHERE a.id = ? AND a.owner_id = ?`,
  ).get(id, ownerId) as AutomationRow | undefined;
  if (!row) return null;
  const automation = rowToAutomation(row);
  return includeRuns ? { ...automation, runs: listRuns(id, ownerId) } : automation;
}

export function listAutomations(ownerId: string) {
  const rows = getDatabase().prepare(
    `SELECT a.*, c.data ->> '$.title' as chat_title
     FROM automations a
     LEFT JOIN chats c ON c.id = a.chat_id
     WHERE a.owner_id = ?
     ORDER BY CASE a.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, a.next_run_at`,
  ).all(ownerId) as AutomationRow[];
  return rows.map((row) => {
    const automation = rowToAutomation(row);
    return { ...automation, runs: listRuns(automation.id, ownerId) };
  });
}

export function updateAutomation(
  id: string,
  ownerId: string,
  patch: Partial<Pick<Automation, "name" | "prompt" | "schedule" | "timezone" | "chatId" | "modeId" | "modelId" | "extendedModelId">>,
) {
  const current = getAutomation(id, ownerId, false);
  if (!current) return null;
  const schedule = patch.schedule ? validateSchedule(patch.schedule) : current.schedule;
  const chat = patch.chatId ? getChat(patch.chatId, ownerId) : getChat(current.chatId, ownerId);
  if (!chat || chat.incognito) throw new Error("A valid non-incognito target chat is required.");
  const now = iso();
  const storedSchedule = scheduleStorage(schedule);
  const nextRunAt = patch.schedule
    ? schedule.kind === "once" ? schedule.at : nextRunFor(schedule)
    : current.nextRunAt || nextRunFor(schedule);
  getDatabase().prepare(
    `UPDATE automations SET chat_id = ?, name = ?, prompt = ?, mode_id = ?, model_id = ?, extended_model_id = ?,
       schedule_kind = ?, schedule_value = ?, timezone = ?, next_run_at = ?, status = CASE WHEN status = 'completed' THEN 'active' ELSE status END,
       last_error = NULL, updated_at = ? WHERE id = ? AND owner_id = ?`,
  ).run(
    chat.id,
    patch.name?.trim().slice(0, 200) || current.name,
    patch.prompt?.trim().slice(0, 100_000) || current.prompt,
    patch.modeId?.trim().slice(0, 100) || current.modeId || null,
    patch.modelId?.trim().slice(0, 300) || current.modelId || null,
    patch.extendedModelId?.trim().slice(0, 300) || current.extendedModelId || null,
    storedSchedule.kind,
    storedSchedule.value,
    patch.timezone?.trim().slice(0, 80) || current.timezone,
    nextRunAt,
    now,
    id,
    ownerId,
  );
  return getAutomation(id, ownerId);
}

export function setAutomationStatus(id: string, ownerId: string, status: "active" | "paused") {
  const current = getAutomation(id, ownerId, false);
  if (!current) return null;
  const nextRunAt = status === "active"
    ? current.nextRunAt || nextRunFor(current.schedule)
    : current.nextRunAt;
  getDatabase().prepare(
    "UPDATE automations SET status = ?, next_run_at = ?, last_error = NULL, updated_at = ? WHERE id = ? AND owner_id = ?",
  ).run(status, nextRunAt ?? null, iso(), id, ownerId);
  return getAutomation(id, ownerId);
}

export function deleteAutomation(id: string, ownerId: string) {
  return Boolean(getDatabase().prepare("DELETE FROM automations WHERE id = ? AND owner_id = ?").run(id, ownerId).changes);
}

export function claimDueAutomations(limit = 10) {
  return transaction(() => {
    const now = Date.now();
    const rows = getDatabase().prepare(
      `SELECT a.*, c.data ->> '$.title' as chat_title
       FROM automations a
       LEFT JOIN chats c ON c.id = a.chat_id
       WHERE a.status = 'active' AND a.next_run_at IS NOT NULL AND a.next_run_at <= ?
         AND (a.claimed_at IS NULL OR a.claimed_at < ?)
       ORDER BY a.next_run_at ASC LIMIT ?`,
    ).all(new Date(now).toISOString(), new Date(now - 15 * 60_000).toISOString(), limit) as AutomationRow[];
    for (const row of rows) {
      getDatabase().prepare("UPDATE automations SET claimed_at = ?, updated_at = ? WHERE id = ?").run(
        new Date(now).toISOString(),
        iso(),
        row.id,
      );
    }
    return rows.map(rowToAutomation);
  });
}

export function startAutomationRun(automation: Automation, options?: { manual?: boolean }) {
  const id = randomUUID();
  const now = iso();
  // Automation runs intentionally share the configured target chat. This keeps
  // the complete durable conversation available to the next scheduled run.
  const runChat = getChat(automation.chatId, automation.ownerId);
  if (!runChat || runChat.incognito) throw new Error("Automation target chat is no longer available.");
  const messageId = randomUUID();
  appendMessage(runChat.id, {
    id: messageId,
    role: "user",
    content: automation.prompt,
  });
  getDatabase().prepare(
    "INSERT INTO automation_runs (id, automation_id, chat_id, status, created_at, manual) VALUES (?, ?, ?, 'queued', ?, ?)",
  ).run(id, automation.id, runChat.id, now, options?.manual ? 1 : 0);
  return { id, chatId: runChat.id, messageId };
}

export function runAutomationNow(id: string, ownerId: string) {
  const automation = getAutomation(id, ownerId);
  if (!automation) return null;
  if ((automation.runs || []).some((run) => run.status === "queued" || run.status === "running")) {
    const error = new Error("This automation is already running.");
    error.name = "ActiveAutomationRun";
    throw error;
  }
  const run = startAutomationRun(automation, { manual: true });
  try {
    const job = enqueueJob({
      chatId: run.chatId,
      userId: automation.ownerId,
      message: automation.prompt,
      messageId: run.messageId,
      ...(automation.modeId ? { modeId: automation.modeId } : {}),
      ...(automation.modelId ? { modelId: automation.modelId } : {}),
      ...(automation.extendedModelId ? { extendedModelId: automation.extendedModelId } : {}),
      automationId: automation.id,
      automationRunId: run.id,
    });
    linkAutomationRunJob(run.id, job.id);
    updateChat(run.chatId, {
      runStatus: "running",
      runUpdatedAt: iso(),
      badge: null,
      ...(job.queueMessage ? { queueMessage: job.queueMessage } : { queueMessage: null }),
    }, ownerId);
    return { automation: getAutomation(id, ownerId), jobId: job.id, chatId: run.chatId };
  } catch (error) {
    getDatabase().prepare(
      "UPDATE automation_runs SET status = 'error', error = ?, completed_at = ? WHERE id = ?",
    ).run(error instanceof Error ? error.message.slice(0, 2_000) : "Could not start run.", iso(), run.id);
    throw error;
  }
}

export function linkAutomationRunJob(runId: string, jobId: string) {
  getDatabase().prepare("UPDATE automation_runs SET job_id = ?, status = 'running', started_at = ? WHERE id = ?")
    .run(jobId, iso(), runId);
}

export function failAutomationClaim(id: string, ownerId: string, error: string) {
  getDatabase().prepare(
    "UPDATE automations SET status = 'error', last_error = ?, claimed_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?",
  ).run(error.slice(0, 2_000), iso(), id, ownerId);
}

export function finalizeAutomationRunForJob(jobId: string) {
  const job = getJob(jobId);
  if (!job?.automationId || !job.automationRunId) return;
  const row = getDatabase().prepare(
    `SELECT r.id, r.automation_id as automationId, a.owner_id as ownerId, a.schedule_kind as scheduleKind,
            a.schedule_value as scheduleValue, a.next_run_at as nextRunAt, r.manual as manual
     FROM automation_runs r JOIN automations a ON a.id = r.automation_id
     WHERE r.id = ? AND r.job_id = ?`,
  ).get(job.automationRunId, jobId) as {
    id: string; automationId: string; ownerId: string; scheduleKind: "once" | "interval";
    scheduleValue: string; nextRunAt: string | null; manual?: number;
  } | undefined;
  if (!row) return;
  const completed = job.status === "completed";
  const status = completed ? "completed" : job.status === "cancelled" ? "cancelled" : "error";
  const now = iso();
  const error = job.error?.slice(0, 2_000);
  getDatabase().prepare(
    "UPDATE automation_runs SET status = ?, completed_at = ?, error = ?, result_preview = ? WHERE id = ?",
  ).run(status, now, error || null, completed ? "Automation run completed." : null, row.id);
  if (Number(row.manual) === 1) {
    getDatabase().prepare(
      `UPDATE automations SET last_run_at = ?, last_error = ?, claimed_at = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    ).run(now, completed ? null : error || null, now, row.automationId, row.ownerId);
    return;
  }
  const storedSchedule = scheduleFromStorage(row.scheduleKind, row.scheduleValue);
  const next = completed && storedSchedule.kind !== "once"
    ? nextRunFor(storedSchedule, Math.max(Date.now(), row.nextRunAt ? new Date(row.nextRunAt).getTime() : Date.now()))
    : null;
  getDatabase().prepare(
    `UPDATE automations SET status = ?, next_run_at = ?, last_run_at = ?, last_error = ?,
       claimed_at = NULL, updated_at = ? WHERE id = ? AND owner_id = ?`,
  ).run(
    completed && storedSchedule.kind !== "once" ? "active" : completed ? "completed" : "error",
    next,
    now,
    error || null,
    now,
    row.automationId,
    row.ownerId,
  );
}


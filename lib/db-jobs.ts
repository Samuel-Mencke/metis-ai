import { randomUUID } from "node:crypto";
import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import type { AgentJob, JobStatus } from "@/lib/jobs";
import { updateChat } from "@/lib/db-store";
import { workerConcurrency } from "@/lib/worker-concurrency";

const iso = () => new Date().toISOString();
const RUN_EVENT_RETENTION = 10_000;
let lastRunEventCleanupAt = 0;

export function enqueueJob(input: Omit<AgentJob, "id" | "status" | "attempts" | "createdAt" | "updatedAt">) {
  return transaction(() => {
    if (input.messageId) {
      const existingRow = getDatabase().prepare(
        "SELECT data FROM jobs WHERE chat_id = ? AND json_extract(data, '$.messageId') = ? ORDER BY updated_at DESC LIMIT 1",
      ).get(input.chatId, input.messageId);
      const existing = parseData<AgentJob>(existingRow);
      if (existing) return existing;
    }
    const active = getDatabase()
      .prepare(
        `SELECT data FROM jobs
         WHERE chat_id = ? AND status IN ('queued', 'running', 'waiting_input', 'waiting_for_user')
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(input.chatId);
    const activeJob = parseData<AgentJob>(active);
    if (activeJob) {
      const error = new Error("This chat already has an active run.");
      error.name = "ActiveChatRun";
      throw error;
    }
    const now = iso();
    const maxWorkers = workerConcurrency();
    const running = Number(
      (getDatabase().prepare(
        "SELECT COUNT(*) as count FROM jobs WHERE status = 'running'",
      ).get() as { count?: number }).count || 0,
    );
    const queued = Number(
      (getDatabase().prepare(
        "SELECT COUNT(*) as count FROM jobs WHERE status = 'queued'",
      ).get() as { count?: number }).count || 0,
    );
    const queueMessage = running >= maxWorkers
      ? `Max workers reached (${maxWorkers}). Waiting for other runs to finish before starting this one.`
      : queued > 0
        ? `Waiting for ${queued} queued run${queued === 1 ? "" : "s"} before starting.`
        : undefined;
    const job: AgentJob = {
      ...input,
      ...(queueMessage ? { queueMessage } : {}),
      id: randomUUID(),
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };
    getDatabase().prepare(
      "INSERT INTO jobs (id, chat_id, user_id, data, status, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(job.id, job.chatId, job.userId ?? null, JSON.stringify(job), job.status, now);
    return job;
  });
}

export function getActiveJob(chatId: string, userId?: string) {
  const row = getDatabase()
    .prepare(
      `SELECT data FROM jobs
       WHERE chat_id = ?
         AND status IN ('queued', 'running', 'waiting_input', 'waiting_for_user')
         AND (? IS NULL OR user_id = ? OR user_id IS NULL)
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(chatId, userId ?? null, userId ?? null);
  return parseData<AgentJob>(row);
}

export function getJob(id: string) {
  return parseData<AgentJob>(getDatabase().prepare("SELECT data FROM jobs WHERE id = ?").get(id));
}

export function listJobs(chatId?: string, userId?: string) {
  const rows = getDatabase().prepare(
    `SELECT data FROM jobs
     WHERE (? IS NULL OR chat_id = ?) AND (? IS NULL OR user_id = ? OR user_id IS NULL)
     ORDER BY updated_at DESC`,
  ).all(chatId ?? null, chatId ?? null, userId ?? null, userId ?? null);
  return rows.map((row) => parseData<AgentJob>(row)).filter((job): job is AgentJob => Boolean(job));
}

export function claimNextJob() {
  return transaction(() => {
    const db = getDatabase();
    const row = db.prepare("SELECT data FROM jobs WHERE status = 'queued' ORDER BY updated_at ASC LIMIT 1").get();
    const job = parseData<AgentJob>(row);
    if (!job) return null;
    const claimed = { ...job, status: "running" as const, claimedAt: iso(), attempts: job.attempts + 1, updatedAt: iso() };
    db.prepare("UPDATE jobs SET data = ?, status = ?, updated_at = ? WHERE id = ? AND status = 'queued'")
      .run(JSON.stringify(claimed), claimed.status, claimed.updatedAt, claimed.id);
    return claimed;
  });
}

export function updateJob(id: string, patch: Partial<Pick<AgentJob, "status" | "error" | "agentId" | "claimedAt" | "resumePrompt" | "resumeRequestedAt" | "runId">>) {
  return transaction(() => {
    const current = getJob(id);
    if (!current) return null;
    const updated = { ...current, ...patch, updatedAt: iso() };
    getDatabase().prepare("UPDATE jobs SET data = ?, status = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(updated), updated.status, updated.updatedAt, id);
    return updated;
  });
}

export function touchJob(id: string) {
  const current = getJob(id);
  if (!current || current.status !== "running") return current;
  const updated = { ...current, updatedAt: iso() };
  getDatabase().prepare("UPDATE jobs SET data = ?, updated_at = ? WHERE id = ? AND status = 'running'")
    .run(JSON.stringify(updated), updated.updatedAt, id);
  return updated;
}

export function recoverStaleJobs(maxAgeMs = 15 * 60 * 1000) {
  const jobs = listJobs();
  const cutoff = Date.now() - maxAgeMs;
  return jobs.filter((job) => {
    if (job.status !== "running" || new Date(job.updatedAt).getTime() >= cutoff) return job.status === "queued";
    const pendingQuestion = getDatabase().prepare(
      "SELECT question_id FROM pending_questions WHERE job_id = ? AND status = 'waiting_for_user' LIMIT 1",
    ).get(job.id);
    if (pendingQuestion) {
      updateJob(job.id, { status: "waiting_input", error: "Paused for user input after worker restart." });
      updateChat(job.chatId, { runStatus: "waiting_for_user", runUpdatedAt: iso() }, job.userId);
      return false;
    }
    updateJob(job.id, { status: "interrupted", error: "Run interrupted by a worker restart; manual resume is required." });
    updateChat(job.chatId, {
      runStatus: "interrupted",
      runUpdatedAt: iso(),
      badge: "red",
    }, job.userId);
    return false;
  });
}

export function appendRunEvent(jobId: string, chatId: string, userId: string | undefined, event: string, data: unknown) {
  const createdAt = iso();
  const db = getDatabase();
  const result = db.prepare(
    "INSERT INTO run_events (job_id, chat_id, user_id, event, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(jobId, chatId, userId ?? null, event, JSON.stringify(data), createdAt);
  if (Date.now() - lastRunEventCleanupAt >= 30_000) {
    lastRunEventCleanupAt = Date.now();
    db.prepare(
      `DELETE FROM run_events
       WHERE id <= (SELECT MAX(id) - ? FROM run_events)`,
    ).run(RUN_EVENT_RETENTION);
  }
  return { id: Number(result.lastInsertRowid), jobId, chatId, event, data, createdAt };
}

export function listRunEvents(
  chatId: string,
  userId: string | undefined,
  after = 0,
  jobId?: string,
) {
  const rows = getDatabase().prepare(
    `SELECT id, job_id as jobId, chat_id as chatId, event, data, created_at as createdAt
     FROM run_events
     WHERE chat_id = ? AND id > ?
       AND (? IS NULL OR job_id = ?)
       AND (? IS NULL OR user_id = ? OR user_id IS NULL)
     ORDER BY id ASC
     LIMIT 500`,
  ).all(
    chatId,
    after,
    jobId ?? null,
    jobId ?? null,
    userId ?? null,
    userId ?? null,
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...row, id: Number(row.id), data: JSON.parse(String(row.data)) }));
}

export function requestJobCancel(chatId: string, userId?: string) {
  const job = getActiveJob(chatId, userId);
  if (!job) return null;
  return updateJob(job.id, { status: "cancelled", error: "Cancellation requested by user." });
}

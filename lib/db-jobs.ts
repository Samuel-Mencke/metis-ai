import { randomUUID } from "node:crypto";
import { getDatabase, parseData, transaction } from "@/lib/sqlite";
import type { AgentJob, JobStatus } from "@/lib/jobs";

const iso = () => new Date().toISOString();

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
         WHERE chat_id = ? AND status IN ('queued', 'running', 'waiting_input')
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
    const job: AgentJob = { ...input, id: randomUUID(), status: "queued", attempts: 0, createdAt: now, updatedAt: now };
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
         AND status IN ('queued', 'running', 'waiting_input')
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

export function updateJob(id: string, patch: Partial<Pick<AgentJob, "status" | "error" | "agentId" | "claimedAt">>) {
  const current = getJob(id);
  if (!current) return null;
  const updated = { ...current, ...patch, updatedAt: iso() };
  getDatabase().prepare("UPDATE jobs SET data = ?, status = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(updated), updated.status, updated.updatedAt, id);
  return updated;
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
    updateJob(job.id, { status: "queued", error: "Recovered after worker restart." });
    return true;
  });
}

export function appendRunEvent(jobId: string, chatId: string, userId: string | undefined, event: string, data: unknown) {
  const createdAt = iso();
  const result = getDatabase().prepare(
    "INSERT INTO run_events (job_id, chat_id, user_id, event, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(jobId, chatId, userId ?? null, event, JSON.stringify(data), createdAt);
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
     ORDER BY id ASC`,
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

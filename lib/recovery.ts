import { listJobs } from "@/lib/db-jobs";
import { createSnapshot, getLatestSnapshot, SNAPSHOT_SCHEMA_VERSION } from "@/lib/shared-context";
import type { AgentJob } from "@/lib/jobs";
import type { SessionSnapshot } from "@/lib/store";

const LIVE_JOB_STATUSES = new Set(["queued", "running", "waiting_input", "waiting_for_user"]);
const STALE_RUNNING_MS = 90_000;

function emptySnapshot(chatId: string, ownerId?: string): SessionSnapshot {
  const timestamp = new Date().toISOString();
  return {
    id: "",
    chatId,
    ...(ownerId ? { ownerId } : {}),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    checkpoint: "recovery",
    runStatus: "idle",
    availability: "not_available",
  };
}

function isFresh(job: AgentJob, maxAgeMs = STALE_RUNNING_MS) {
  const updatedAt = Date.parse(job.updatedAt);
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt < maxAgeMs;
}

export function snapshotInterruptedJob(job: AgentJob) {
  return createSnapshot({
    chatId: job.chatId,
    ...(job.userId ? { ownerId: job.userId } : {}),
    checkpoint: "recovery",
    runStatus: "interrupted",
    resumeMarker: {
      jobId: job.id,
      runId: job.runId || job.id,
      safe: Boolean(job.agentId),
      reason: job.error || "Run interrupted by a worker restart; manual resume is required.",
    },
    availability: "needs_attention",
  });
}

export function resolveRecoverySnapshot(chatId: string, ownerId?: string): SessionSnapshot | null {
  const snapshot = getLatestSnapshot(chatId, ownerId);
  const jobs = listJobs(chatId, ownerId);
  const latestJob = jobs[0] ?? null;
  const liveJob = jobs.find((job) => {
    if (!LIVE_JOB_STATUSES.has(job.status)) return false;
    return job.status !== "running" || isFresh(job);
  });

  if (liveJob) {
    return {
      ...(snapshot ?? emptySnapshot(chatId, ownerId)),
      runStatus: liveJob.status === "waiting_input" || liveJob.status === "waiting_for_user"
        ? "waiting_for_user"
        : "running",
      availability: "available",
      resumeMarker: {
        jobId: liveJob.id,
        runId: liveJob.runId || liveJob.id,
        safe: true,
        reason: "Run is currently active.",
      },
    };
  }

  const zombie = jobs.find((job) => job.status === "running" && !isFresh(job));
  const interruptedJob = latestJob?.status === "interrupted" ? latestJob : zombie ?? null;

  if (interruptedJob) {
    const dismissed = Boolean(
      snapshot &&
      snapshot.availability !== "needs_attention" &&
      snapshot.updatedAt > interruptedJob.updatedAt,
    );
    if (dismissed) {
      return { ...snapshot!, availability: "available" };
    }
    return {
      ...(snapshot ?? emptySnapshot(chatId, ownerId)),
      checkpoint: "recovery",
      runStatus: "interrupted",
      availability: "needs_attention",
      resumeMarker: {
        jobId: interruptedJob.id,
        runId: interruptedJob.runId || interruptedJob.id,
        safe: Boolean(interruptedJob.agentId),
        reason: interruptedJob.error || "The last run was interrupted by a restart.",
      },
    };
  }

  if (!snapshot) return null;
  if (snapshot.availability === "needs_attention" || snapshot.runStatus === "running") {
    return {
      ...snapshot,
      availability: "available",
      runStatus: snapshot.runStatus === "running" ? "idle" : snapshot.runStatus,
      resumeMarker: snapshot.resumeMarker
        ? { ...snapshot.resumeMarker, safe: true }
        : undefined,
    };
  }
  return snapshot;
}

import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { claimNextJob, getJob, recoverStaleJobs, updateJob } from "@/lib/db-jobs";
import { updateChat } from "@/lib/db-store";

const pollMs = Number(process.env.AI_CHAT_WORKER_POLL_MS || 500);
const configuredConcurrency = Number(process.env.AI_CHAT_WORKER_CONCURRENCY || 4);
const concurrency = Number.isFinite(configuredConcurrency) ? Math.max(1, configuredConcurrency) : 4;
const configuredMaxJobMs = Number(process.env.AI_CHAT_WORKER_MAX_JOB_MS || 30 * 60 * 1000);
const maxJobMs = Number.isFinite(configuredMaxJobMs)
  ? Math.max(60_000, configuredMaxJobMs)
  : 30 * 60 * 1000;
let stopping = false;

function stop() {
  stopping = true;
}

function runJobInIsolatedProcess(jobId: string) {
  return new Promise<void>((resolveProcess, reject) => {
    const markFailed = (message: string) => {
      updateJob(jobId, { status: "error", error: message });
      const job = getJob(jobId);
      if (job) {
        updateChat(job.chatId, {
          runStatus: "error",
          runUpdatedAt: new Date().toISOString(),
          badge: null,
        }, job.userId);
      }
    };
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      markFailed(`Worker job exceeded the ${Math.round(maxJobMs / 60_000)} minute limit.`);
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    }, maxJobMs);
    const child = spawn(
      process.execPath,
      [resolve("node_modules/tsx/dist/cli.mjs"), "worker-job.ts", jobId],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (code === 0) {
        resolveProcess();
        return;
      }
      const message = signal
        ? `Isolated worker exited with signal ${signal}.`
        : `Isolated worker exited with code ${code ?? "unknown"}.`;
      markFailed(message);
      reject(new Error(message));
    });
  });
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

async function main() {
  recoverStaleJobs();
  console.log(`[ai-chat-worker] started (concurrency: ${concurrency})`);
  const active = new Set<Promise<void>>();
  while (!stopping) {
    while (!stopping && active.size < concurrency) {
      const job = claimNextJob();
      if (!job) break;
      console.log(`[ai-chat-worker] claimed ${job.id} (${job.chatId})`);
      let task: Promise<void>;
      task = runJobInIsolatedProcess(job.id)
        .catch((error) => {
          console.error(`[ai-chat-worker] job ${job.id} failed`, error);
        })
        .finally(() => active.delete(task));
      active.add(task);
    }
    if (active.size >= concurrency) {
      await Promise.race(active);
      continue;
    }
    if (active.size > 0) {
      await Promise.race(active);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  await Promise.all(active);
  console.log("[ai-chat-worker] stopped");
}

main().catch((error) => {
  console.error("[ai-chat-worker] fatal", error);
  process.exitCode = 1;
});

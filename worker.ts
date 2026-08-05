import { claimNextJob, recoverStaleJobs } from "@/lib/db-jobs";
import { runQueuedJob } from "@/lib/worker-runner";

const pollMs = Number(process.env.AI_CHAT_WORKER_POLL_MS || 500);
const configuredConcurrency = Number(process.env.AI_CHAT_WORKER_CONCURRENCY || 4);
const concurrency = Number.isFinite(configuredConcurrency) ? Math.max(1, configuredConcurrency) : 4;
let stopping = false;

function stop() {
  stopping = true;
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
      task = runQueuedJob(job).finally(() => active.delete(task));
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

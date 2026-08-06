import { runJobById } from "@/lib/worker-runner";

const jobId = process.argv[2]?.trim();

if (!jobId) {
  throw new Error("A job id is required.");
}

runJobById(jobId)
  .then(() => {
    // The SDK can leave stdio/MCP handles open after the run has been
    // persisted. This process is intentionally one-shot; keeping it alive
    // would permanently consume a scheduler concurrency slot.
    process.exit(0);
  })
  .catch((error) => {
    console.error(`[ai-chat-worker-job] ${jobId} failed`, error);
    process.exit(1);
  });

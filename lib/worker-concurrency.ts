export const DEFAULT_WORKER_CONCURRENCY = 25;

export function workerConcurrency(raw = process.env.AI_CHAT_WORKER_CONCURRENCY) {
  const configured = Number(raw || DEFAULT_WORKER_CONCURRENCY);
  return Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : DEFAULT_WORKER_CONCURRENCY;
}

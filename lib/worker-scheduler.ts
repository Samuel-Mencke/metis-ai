export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function describeQueueWait(running: number, queuedAhead: number, maxWorkers: number): string | undefined {
  const workers = Number.isFinite(maxWorkers) ? Math.max(1, Math.floor(maxWorkers)) : 1;
  const freeSlots = Math.max(0, workers - Math.max(0, running));
  const ahead = Math.max(0, queuedAhead);
  // Only surface a wait when this job cannot take a free slot. Queued jobs
  // that still fit in remaining workers start on the next poll — no banner.
  if (ahead < freeSlots) return undefined;
  if (ahead === 0) {
    return `Max workers reached (${workers}). Waiting for a free worker slot.`;
  }
  return `Waiting for a free worker slot (${ahead} run${ahead === 1 ? "" : "s"} ahead, ${workers} parallel chats).`;
}

export async function waitForSchedulerTick(
  active: ReadonlySet<Promise<unknown>>,
  concurrency: number,
  pollMs: number,
): Promise<"idle-poll" | "capacity-poll" | "slot-freed"> {
  if (active.size === 0) {
    await sleep(pollMs);
    return "idle-poll";
  }
  if (active.size >= concurrency) {
    await Promise.race(active);
    return "slot-freed";
  }
  return Promise.race([
    Promise.race(active).then(() => "slot-freed" as const),
    sleep(pollMs).then(() => "capacity-poll" as const),
  ]);
}

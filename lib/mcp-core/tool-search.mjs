export const CHILD_CONNECT_TIMEOUT_MS = 5_000;
export const SEARCH_OVERALL_TIMEOUT_MS = 18_000;
export const SEARCH_STDIO_CONCURRENCY = 2;
export const SEARCH_REMOTE_CONCURRENCY = 4;

export function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function withOverallBudget(work, timeoutMs, fallbackFactory) {
  let timer;
  let settled = false;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (!settled) resolve(fallbackFactory("search_budget_exceeded"));
    }, timeoutMs);
  });
  try {
    const result = await Promise.race([
      Promise.resolve(work).then((value) => {
        settled = true;
        return value;
      }),
      timeout,
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function mapWithConcurrency(items, concurrency, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let next = 0;
  const workers = Math.max(1, Math.min(concurrency, list.length || 1));
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      results[index] = await fn(list[index], index);
    }
  }
  if (!list.length) return results;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export function scoreToolHaystack(query, haystack) {
  const words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const text = String(haystack || "").toLowerCase();
  if (!words.length) return 0;
  return words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
}

export function toolSearchHaystack(entry, tool) {
  return `${entry?.id || ""} ${entry?.name || ""} ${(entry?.tags || []).join(" ")} ${tool?.name || ""} ${tool?.description || ""}`;
}

export function rankToolMatches(found, limit = 20) {
  const capped = Math.max(1, Math.min(Number(limit) || 20, 100));
  return [...found].sort(
    (a, b) => b.score - a.score || String(a.server).localeCompare(String(b.server)) || String(a.name).localeCompare(String(b.name)),
  ).slice(0, capped);
}

export function compactToolMatch(entry, tool, score) {
  return {
    server: entry.id,
    name: tool.name,
    description: String(tool.description || "").slice(0, 240),
    score,
  };
}

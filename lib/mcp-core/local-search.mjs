const DEFAULT_TIMEOUT_MS = 1_500;

function endpointFromEnv() {
  return process.env.MCP_LOCAL_SEARCH_URL?.trim() || "http://127.0.0.1:8888/search";
}

function normalizeResult(result) {
  return {
    title: String(result?.title || "").trim(),
    url: String(result?.url || result?.link || "").trim(),
    content: String(result?.content || result?.snippet || result?.description || "").trim(),
    engine: String(result?.engine || "").trim(),
  };
}

export async function localWebSearch({
  query,
  numResults = 10,
  endpoint = endpointFromEnv(),
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) throw new Error("query is required");
  if (!endpoint) throw new Error("MCP_LOCAL_SEARCH_URL is not configured");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const url = new URL(endpoint);
  url.searchParams.set("q", cleanQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", "general");
  url.searchParams.set("pageno", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": "Metis-LocalSearch/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`local search returned HTTP ${response.status}`);
    const payload = await response.json();
    const results = Array.isArray(payload?.results)
      ? payload.results.map(normalizeResult).filter((result) => result.title && result.url).slice(0, numResults)
      : [];
    return {
      source: "local-searxng",
      query: cleanQuery,
      results,
    };
  } finally {
    clearTimeout(timer);
  }
}

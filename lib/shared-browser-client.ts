import { config } from "@/lib/config";

export type SharedBrowserAction = {
  action: string;
  tabId?: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  x?: number;
  y?: number;
  deltaY?: number;
  width?: number;
  height?: number;
};

export type SharedBrowserResult = {
  sessionId: string;
  tabId: string;
  activeTabId: string;
  url: string;
  title: string;
  tabs: Array<{ id: string; url: string; title: string }>;
  screenshot?: string;
  snapshot?: string;
  viewport: { width: number; height: number };
};

export async function performSharedBrowserAction(
  userId: string,
  chatId: string,
  action: SharedBrowserAction,
) {
  const configuredToken =
    process.env.AI_CHAT_INTERNAL_TOKEN?.trim() ||
    process.env.MCP_BEARER_TOKEN?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-AI-Chat-Internal": "1",
    "X-AI-Chat-Id": chatId,
    "X-AI-Chat-User-Id": userId,
  };
  if (configuredToken) {
    headers.Authorization = `Bearer ${configuredToken}`;
  } else {
    headers["X-Chat-Password"] = process.env.CHAT_PASSWORD?.trim() || "";
  }

  let response: Response;
  try {
    response = await fetch(
      `http://127.0.0.1:${config.port}/__internal/browser-engine`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(action),
        cache: "no-store",
        signal: AbortSignal.timeout(90_000),
      },
    );
  } catch (error) {
    throw new Error(
      error instanceof Error && error.name === "TimeoutError"
        ? "Browser action timed out"
        : "Browser engine is unreachable",
    );
  }
  const data = (await response.json().catch(() => ({}))) as
    | SharedBrowserResult
    | { error?: string };
  if (!response.ok) {
    throw new Error(
      "error" in data && data.error
        ? data.error
        : `Browser action failed (${response.status})`,
    );
  }
  return data as SharedBrowserResult;
}

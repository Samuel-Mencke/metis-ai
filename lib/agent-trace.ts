import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";
import type { AgentJob } from "@/lib/jobs";

const SECRET_KEY = /(?:api[_-]?key|authorization|bearer|password|secret|token|credential|cookie)/i;
const SECRET_VALUE = /\b(?:sk-[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|ghp_[a-zA-Z0-9]{20,})\b/g;
const MAX_STRING = 8_000;
const MAX_DEPTH = 6;

export function agentTraceDir(job?: Pick<AgentJob, "id" | "createdAt">) {
  const day = (job?.createdAt || new Date().toISOString()).slice(0, 10);
  return path.join(config.dataDir, "agent-traces", day);
}

export function agentTracePath(job: Pick<AgentJob, "id" | "createdAt">) {
  return path.join(agentTraceDir(job), `${job.id}.jsonl`);
}

function truncate(value: string) {
  if (value.length <= MAX_STRING) return value.replace(SECRET_VALUE, "[redacted]");
  return `${value.slice(0, MAX_STRING).replace(SECRET_VALUE, "[redacted]")}…[truncated ${value.length - MAX_STRING} chars]`;
}

export function redactTraceValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return truncate(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactTraceValue(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SECRET_KEY.test(key) ? "[redacted]" : redactTraceValue(nested, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function summarizeTraceData(event: string, data: unknown) {
  const record = data && typeof data === "object" ? data as Record<string, unknown> : {};
  if (event === "text" && typeof record.text === "string") {
    return {
      chars: record.text.length,
      tail: truncate(record.text.slice(-400)),
    };
  }
  return redactTraceValue(data);
}

export function appendAgentTrace(
  job: Pick<AgentJob, "id" | "chatId" | "userId" | "createdAt" | "modelId" | "modeId">,
  event: string,
  data?: unknown,
) {
  const row = {
    t: new Date().toISOString(),
    jobId: job.id,
    chatId: job.chatId,
    event,
    data: summarizeTraceData(event, data),
  };
  const line = `${JSON.stringify(row)}\n`;
  try {
    mkdirSync(agentTraceDir(job), { recursive: true });
    appendFileSync(agentTracePath(job), line, "utf8");
  } catch (error) {
    console.error("[agent-trace] write failed", error);
  }
  if (event !== "text") {
    const extra = event === "tool" && data && typeof data === "object"
      ? ` ${(data as { name?: string; status?: string }).name || ""} ${(data as { status?: string }).status || ""}`.trim()
      : "";
    console.log(`[agent-trace] ${job.id.slice(0, 8)} ${event}${extra ? ` ${extra}` : ""}`);
  }
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "@/lib/config";

const heartbeatPath = path.join(config.dataDir, "worker-heartbeat.json");

export function writeWorkerHeartbeat(status: "running" | "stopping" = "running") {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(
    heartbeatPath,
    `${JSON.stringify({ status, pid: process.pid, updatedAt: new Date().toISOString() })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function readWorkerHeartbeat(maxAgeMs = 15_000) {
  try {
    const value = JSON.parse(readFileSync(heartbeatPath, "utf8")) as {
      status?: string;
      pid?: number;
      updatedAt?: string;
    };
    const updatedAt = value.updatedAt ? Date.parse(value.updatedAt) : NaN;
    return {
      ok: value.status === "running" && Number.isFinite(updatedAt) && Date.now() - updatedAt <= maxAgeMs,
      status: value.status || "unknown",
      pid: value.pid,
      updatedAt: value.updatedAt,
    };
  } catch {
    return { ok: false, status: "missing" as const };
  }
}

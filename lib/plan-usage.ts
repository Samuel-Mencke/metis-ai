import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDatabase } from "@/lib/sqlite";
import {
  findActiveConnection,
  getProviderConnectionSecret,
} from "@/lib/provider-connections";
import type { UsageProvider, UsageSnapshot, UsageWindow } from "@/lib/usage-display";
import { parseCursorUsageBody } from "@/lib/usage-display";

export type { UsageProvider, UsageSnapshot, UsageWindow };

/**
 * Central plan-usage module.
 *
 * All subscription/quota lookups for providers with usage limits live here —
 * one module, one cache, one API shape. Nothing else in Metis queries
 * usage endpoints directly.
 *
 * Sources:
 *  - Cursor: GET cursor.com/api/usage-summary (session or API key) plus local Cursor app session
 *  - Codex (ChatGPT plan): `codex app-server --stdio` JSON-RPC `account/rateLimits/read`
 *  - z.ai Coding Plan: GET https://api.z.ai/api/monitor/usage/quota/limit (raw key, no Bearer)
 *  - Antigravity: POST cloudcode-pa.googleapis.com v1internal:fetchAvailableModels (quotaInfo per model)
 *  - Local gateway 5h stats: read-only SQLite on the AiApi-Wrapper gateway.db
 */

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, UsageSnapshot>();
const inflight = new Map<string, Promise<UsageSnapshot>>();

const HOME = process.env.HOME || "/home/samuel";
const BRIDGE_CODEX_HOME = `${HOME}/.cache/plan-bridge/codex-home`;
const CODEX_BIN = process.env.CODEX_BIN || `${HOME}/.npm-global/bin/codex`;
const GATEWAY_DB = process.env.GATEWAY_DB_PATH || `${HOME}/AiApi-Wrapper/data/gateway.db`;
const WRAPPER_ENV = `${HOME}/AiApi-Wrapper/.env`;

function readWrapperEnvKey(names: string[]): string | undefined {
  try {
    const raw = readFileSync(WRAPPER_ENV, "utf8");
    for (const name of names) {
      const m = raw.match(new RegExp(`^${name}=["']?([^"'\\n]+)["']?`, "m"));
      if (m?.[1]) return m[1];
    }
  } catch {
    /* fall through to process.env */
  }
  for (const name of names) {
    const v = process.env[name];
    if (v) return v;
  }
  return undefined;
}

function epochMsToIso(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n > 1e12 ? n : n * 1000; // seconds vs milliseconds
  return new Date(ms).toISOString();
}

/* ---------------- Codex (ChatGPT plan) ---------------- */

type CodexWindow = { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;

function codexWindowLabel(mins: number): string {
  if (mins >= 10080) return "weekly";
  if (mins >= 1400 && mins <= 150) return "weekly";
  if (mins >= 2880) return `${Math.round(mins / 1440)}d`;
  if (mins > 60) return `${Math.round(mins / 60)}h`;
  return `${mins}m`;
}

function codexWindow(w: CodexWindow): UsageWindow | null {
  if (!w || typeof w.usedPercent !== "number") return null;
  return {
    label: codexWindowLabel(w.windowDurationMins),
    usedPercent: Math.round(w.usedPercent),
    resetsAt: epochMsToIso(w.resetsAt),
  };
}

async function fetchCodexUsage(): Promise<UsageProvider> {
  const base: UsageProvider = { key: "codex", name: "Codex (ChatGPT plan)", status: "live", windows: [] };
  return new Promise<UsageProvider>((resolve) => {
    let settled = false;
    const done = (p: UsageProvider) => {
      if (!settled) { settled = true; resolve(p); }
    };
    const timer = setTimeout(() => done({ ...base, status: "error", error: "timeout" }), 20_000);
    try {
      const child = execFile(
        CODEX_BIN,
        ["app-server", "--stdio"],
        {
          env: { ...process.env, CODEX_HOME: BRIDGE_CODEX_HOME },
          timeout: 18_000,
        },
        () => {
          /* handled via stdout below */
        },
      );
      if (!child.stdout || !child.stdin) {
        clearTimeout(timer);
        return done({ ...base, status: "error", error: "spawn failed" });
      }
      let buffer = "";
      const send = (obj: unknown) => {
        try { child.stdin?.write(`${JSON.stringify(obj)}\n`); } catch { /* closed */ }
      };
      child.stdin.on("error", () => {});
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let msg: Record<string, unknown>;
          try { msg = JSON.parse(line); } catch { continue; }
          if (msg.id === 2) {
            clearTimeout(timer);
            try { child.kill("SIGTERM"); } catch { /* noop */ }
            const result = (msg.result as { rateLimits?: Record<string, unknown> } | undefined)?.rateLimits;
            if (!result) return done({ ...base, status: "error", error: "no rate limits in response" });
            const planType = typeof result.planType === "string" ? result.planType : undefined;
            const windows = [
              codexWindow(result.primary as CodexWindow),
              codexWindow(result.secondary as CodexWindow),
            ].filter((w): w is UsageWindow => w !== null);
            return done({
              ...base,
              planLabel: planType ? planType.charAt(0).toUpperCase() + planType.slice(1) : undefined,
              windows,
              extra: {
                spendControlReached: result.spendControlReached === true ? "yes" : "no",
                rateLimitReachedType: typeof result.rateLimitReachedType === "string"
                  ? result.rateLimitReachedType
                  : null,
              },
            });
          }
        }
      });
      child.on("error", () => { clearTimeout(timer); done({ ...base, status: "error", error: "spawn error" }); });
      child.on("close", () => { clearTimeout(timer); done({ ...base, status: "error", error: "app-server exited" }); });
      send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "metis-usage", version: "1.0" } } });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
    } catch (error) {
      clearTimeout(timer);
      done({ ...base, status: "error", error: error instanceof Error ? error.message : "spawn failed" });
    }
  });
}

/* ---------------- z.ai Coding Plan ---------------- */

type ZaiLimit = {
  type?: string;
  percentage?: number;
  nextResetTime?: number;
  unit?: number;
  number?: number;
};

async function fetchZaiUsage(): Promise<UsageProvider> {
  const base: UsageProvider = { key: "zai", name: "z.ai Coding Plan", status: "live", windows: [] };
  const key = readWrapperEnvKey(["GLM_API_KEY", "ZAI_API_KEY", "Z_AI_API_KEY"]);
  if (!key) return { ...base, status: "no_auth", error: "no z.ai API key found" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
      headers: { Authorization: key, Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ...base, status: res.status === 401 ? "no_auth" : "error", error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      data?: { limits?: ZaiLimit[]; level?: string };
    };
    const limits = body.data?.limits ?? [];
    const level = typeof body.data?.level === "string" ? body.data.level : undefined;
    const windows: UsageWindow[] = [];
    for (const limit of limits) {
      if (limit.type === "TOKENS_LIMIT") {
        const hours = limit.number && limit.unit === 3 ? limit.number : 5;
        windows.push({
          label: `${hours}h`,
          usedPercent: typeof limit.percentage === "number" ? Math.round(limit.percentage) : null,
          resetsAt: epochMsToIso(limit.nextResetTime),
        });
      } else if (limit.type === "TIME_LIMIT") {
        windows.push({
          label: limit.number === 1 && limit.unit === 5 ? "monthly" : "time",
          usedPercent: typeof limit.percentage === "number" ? Math.round(limit.percentage) : null,
          resetsAt: epochMsToIso(limit.nextResetTime),
        });
      }
    }
    return {
      ...base,
      planLabel: level ? level.charAt(0).toUpperCase() + level.slice(1) : undefined,
      windows,
    };
  } catch (error) {
    return { ...base, status: "error", error: error instanceof Error ? error.message : "fetch failed" };
  }
}

/* ---------------- Antigravity ---------------- */

async function fetchAntigravityUsage(): Promise<UsageProvider> {
  const base: UsageProvider = { key: "antigravity", name: "Antigravity", status: "live", windows: [] };
  let token: string | undefined;
  try {
    const raw = JSON.parse(
      readFileSync(`${HOME}/.gemini/antigravity-cli/antigravity-oauth-token`, "utf8"),
    ) as { token?: unknown };
    if (typeof raw.token === "string") token = raw.token;
    else if (raw.token && typeof raw.token === "object") {
      token = (raw.token as { access_token?: string }).access_token;
    }
  } catch {
    /* no token file */
  }
  if (!token) return { ...base, status: "no_auth", error: "no antigravity OAuth token" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "antigravity-usage/1.0",
        },
        body: "{}",
        signal: controller.signal,
      },
    );
    clearTimeout(timer);
    if (!res.ok) {
      return { ...base, status: res.status === 401 || res.status === 403 ? "no_auth" : "error", error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      models?: Record<string, { quotaInfo?: { remainingFraction?: number; resetTime?: string } }>;
    };
    const models = body.models ?? {};
    // Aggregate: show the most constrained model window + reset time of the soonest reset.
    let soonestReset: string | null = null;
    let mostUsedPercent: number | null = null;
    let constrainedModel: string | null = null;
    for (const [id, model] of Object.entries(models)) {
      const reset = model.quotaInfo?.resetTime ?? null;
      if (reset && (!soonestReset || reset < soonestReset)) soonestReset = reset;
      const remaining = model.quotaInfo?.remainingFraction;
      if (typeof remaining === "number" && Number.isFinite(remaining)) {
        const used = Math.round((1 - remaining) * 100);
        if (mostUsedPercent === null || used > mostUsedPercent) {
          mostUsedPercent = used;
          constrainedModel = id;
        }
      }
    }
    return {
      ...base,
      windows: [{
        label: "quota",
        usedPercent: mostUsedPercent,
        resetsAt: soonestReset,
      }],
      extra: {
        models: Object.keys(models).length,
        mostConstrained: constrainedModel,
      },
    };
  } catch (error) {
    return { ...base, status: "error", error: error instanceof Error ? error.message : "fetch failed" };
  }
}

/* ---------------- Local gateway 5h stats ---------------- */

function fetchGateway5h(): UsageProvider[] {
  // Read-only access to the AiApi-Wrapper request log.
  // NOTE: created_at strings are ISO-8601 with "T" separators; the cutoff must
  // use the same format or string comparison overcounts.
  try {
    const Database = require("node:sqlite").DatabaseSync as new (p: string, o?: unknown) => {
      prepare: (sql: string) => { all: (...a: unknown[]) => unknown[] };
      close?: () => void;
    };
    const db = new Database(`file:${GATEWAY_DB}?mode=ro`, { open: true });
    const cutoff = new Date(Date.now() - 5 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "");
    const rows = db.prepare(
      `SELECT provider, model_alias, real_model, COUNT(*) as requests,
              SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)) as tokens,
              SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors
       FROM requests WHERE created_at >= ?
       GROUP BY provider, model_alias, real_model
       ORDER BY requests DESC`,
    ).all(cutoff) as Array<{
      provider: string;
      model_alias: string;
      real_model: string;
      requests: number;
      tokens: number;
      errors: number;
    }>;
    db.close?.();
    return rows.map((row) => ({
      key: `gateway:${row.provider}:${row.model_alias}`,
      name: `Gateway · ${row.provider} · ${row.model_alias}`,
      status: "live" as const,
      windows: [],
      extra: {
        model: row.real_model || row.model_alias,
        requests5h: row.requests,
        tokens5h: row.tokens,
        errors5h: row.errors,
        telemetry: "local",
      },
    }));
  } catch {
    return [];
  }
}

function fetchMetisTelemetry5h(): UsageProvider[] {
  // Cursor and other SDK providers do not expose a portable usage/quota API.
  // Their completed runs are still represented by Metis' local model_signals
  // table. This is local telemetry, never presented as official provider quota.
  try {
    const db = getDatabase();
    const cutoff = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(
      `SELECT model_id, COUNT(*) AS requests,
              SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens,
              SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors
       FROM model_signals
       WHERE created_at >= ?
       GROUP BY model_id
       ORDER BY requests DESC`,
    ).all(cutoff) as Array<{
      model_id: string;
      requests: number;
      tokens: number;
      errors: number;
    }>;
    return rows.map((row) => ({
      key: `local:${row.model_id}`,
      name: `Local · ${row.model_id}`,
      status: "live" as const,
      windows: [],
      extra: {
        model: row.model_id,
        requests5h: row.requests,
        tokens5h: row.tokens,
        errors5h: row.errors,
        telemetry: "local",
      },
    }));
  } catch {
    // model_signals is created lazily; absence is a normal first-run state.
    return [];
  }
}

/* ---------------- Cursor ---------------- */

function decodeJwtSub(token: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function readCursorAppSession(): string | undefined {
  const envToken = process.env.CURSOR_SESSION_TOKEN || process.env.WORKOS_CURSOR_SESSION_TOKEN;
  if (envToken?.trim()) return envToken.trim();
  const home = homedir();
  const candidates = [
    path.join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    path.join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
    path.join(home, "AppData/Roaming/Cursor/User/globalStorage/state.vscdb"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const db = new DatabaseSync(`file:${file}?mode=ro`, { open: true });
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get("cursorAuth/accessToken") as
        | { value?: string }
        | undefined;
      db.close();
      if (typeof row?.value === "string" && row.value.trim()) return row.value.trim();
    } catch {
      /* try next path */
    }
  }
  return undefined;
}

async function cursorFetchJson(url: string, token: string): Promise<unknown> {
  const sub = decodeJwtSub(token);
  const cookie = sub ? `${sub}::${token}` : token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        Cookie: `WorkosCursorSessionToken=${cookie}`,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCursorUsage(ownerId?: string): Promise<UsageProvider> {
  const base: UsageProvider = { key: "cursor", name: "Cursor", status: "live", windows: [] };
  const tokens: string[] = [];
  if (ownerId) {
    try {
      const connection = findActiveConnection(ownerId, "cursor");
      const secret = connection ? getProviderConnectionSecret(connection.id, ownerId)?.secret : undefined;
      if (secret?.trim()) tokens.push(secret.trim());
    } catch {
      /* no stored Cursor key */
    }
  }
  const session = readCursorAppSession();
  if (session && !tokens.includes(session)) tokens.push(session);

  if (!tokens.length) return { ...base, status: "no_auth" };

  let lastError = "no usage payload";
  const urls = [
    "https://cursor.com/api/usage-summary",
    "https://www.cursor.com/api/usage-summary",
  ];
  for (const token of tokens) {
    for (const url of urls) {
      try {
        const body = await cursorFetchJson(url, token);
        const parsed = parseCursorUsageBody(body);
        if (parsed) return { ...base, ...parsed };
        lastError = "unsupported usage payload";
      } catch (error) {
        lastError = error instanceof Error ? error.message : "fetch failed";
      }
    }
  }
  const noAuth = /HTTP 401|HTTP 403/.test(lastError);
  return { ...base, status: noAuth ? "no_auth" : "error", error: lastError };
}

/* ---------------- Aggregate + cache ---------------- */

async function collect(ownerId?: string): Promise<UsageSnapshot> {
  const results = await Promise.allSettled([
    fetchCursorUsage(ownerId),
    fetchCodexUsage(),
    fetchZaiUsage(),
    fetchAntigravityUsage(),
  ]);
  const providers: UsageProvider[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") providers.push(result.value);
  }
  providers.push(...fetchGateway5h());
  providers.push(...fetchMetisTelemetry5h());
  return { providers, fetchedAt: new Date().toISOString() };
}

export async function getPlanUsage(force = false, ownerId?: string): Promise<UsageSnapshot> {
  const key = ownerId || "global";
  const cached = cache.get(key);
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
    return cached;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = collect(ownerId)
    .then((snapshot) => {
      cache.set(key, snapshot);
      return snapshot;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

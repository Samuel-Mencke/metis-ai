import { getDatabase, withSqliteRetry } from "@/lib/sqlite";

export const ERROR_LOG_LEVELS = ["error", "warn", "info"] as const;
export const ERROR_LOG_SOURCES = [
  "frontend",
  "api",
  "worker",
  "ws",
  "telegram",
  "browser",
  "system",
] as const;

export type ErrorLogLevel = (typeof ERROR_LOG_LEVELS)[number];
export type ErrorLogSource = (typeof ERROR_LOG_SOURCES)[number];

export type ErrorLogEntry = {
  id?: number;
  ts?: number;
  level: ErrorLogLevel;
  source: ErrorLogSource;
  chatId?: string;
  userId?: string;
  sessionLabel?: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

export type ErrorLogRow = {
  id: number;
  ts: number;
  level: ErrorLogLevel;
  source: ErrorLogSource;
  chatId: string | null;
  userId: string | null;
  sessionLabel: string | null;
  message: string;
  stack: string | null;
  context: Record<string, unknown> | null;
};

export type ErrorLogQuery = {
  since?: number;
  source?: ErrorLogSource;
  level?: ErrorLogLevel;
  chatId?: string;
  limit?: number;
};

export function isErrorLogLevel(value: unknown): value is ErrorLogLevel {
  return (ERROR_LOG_LEVELS as readonly string[]).includes(String(value));
}

export function isErrorLogSource(value: unknown): value is ErrorLogSource {
  return (ERROR_LOG_SOURCES as readonly string[]).includes(String(value));
}

function normalizeContext(value: unknown): string | null {
  if (value == null) return null;
  try {
    const json = JSON.stringify(value);
    if (!json || json === "null") return null;
    return json.length > 32_768 ? json.slice(0, 32_768) : json;
  } catch {
    return null;
  }
}

function parseContext(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: value.slice(0, 2_000) };
  }
}

/** Ensure the error_logs table exists. Safe to call repeatedly. */
export function ensureErrorLogsTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('error', 'warn', 'info')),
      source TEXT NOT NULL CHECK (source IN ('frontend', 'api', 'worker', 'ws', 'telegram', 'browser', 'system')),
      chat_id TEXT,
      user_id TEXT,
      session_label TEXT,
      message TEXT NOT NULL,
      stack TEXT,
      context TEXT
    );
    CREATE INDEX IF NOT EXISTS error_logs_ts ON error_logs(ts);
    CREATE INDEX IF NOT EXISTS error_logs_source ON error_logs(source, ts);
    CREATE INDEX IF NOT EXISTS error_logs_chat_id ON error_logs(chat_id, ts);
  `);
}

/**
 * Insert one error log entry. Fire-and-forget safe: never throws into the
 * caller. Returns the inserted row id, or 0 when validation or insertion
 * failed.
 */
export function logError(entry: ErrorLogEntry): number {
  try {
    if (!entry || typeof entry !== "object") return 0;
    if (!isErrorLogLevel(entry.level)) return 0;
    if (!isErrorLogSource(entry.source)) return 0;
    const message = String(entry.message ?? "");
    if (!message.trim()) return 0;
    ensureErrorLogsTable();
    const db = getDatabase();
    const result = withSqliteRetry(() =>
      db
        .prepare(
          `
        INSERT INTO error_logs (ts, level, source, chat_id, user_id, session_label, message, stack, context)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          typeof entry.ts === "number" && Number.isFinite(entry.ts)
            ? Math.trunc(entry.ts)
            : Date.now(),
          entry.level,
          entry.source,
          entry.chatId?.trim() || null,
          entry.userId?.trim() || null,
          entry.sessionLabel?.trim()?.slice(0, 200) || null,
          message.slice(0, 8_192),
          entry.stack?.trim()?.slice(0, 16_384) || null,
          normalizeContext(entry.context),
        ),
    );
    return Number(result.lastInsertRowid || 0);
  } catch {
    return 0;
  }
}

/** Convenience wrapper for browser/client reports. */
export function logFrontendError(
  message: string,
  options: Partial<Omit<ErrorLogEntry, "message" | "source">> = {},
): number {
  return logError({
    ...options,
    message,
    level: options.level ?? "error",
    source: "frontend",
  });
}

function rowToEntry(row: Record<string, unknown>): ErrorLogRow {
  return {
    id: Number(row.id),
    ts: Number(row.ts),
    level: String(row.level) as ErrorLogLevel,
    source: String(row.source) as ErrorLogSource,
    chatId: row.chat_id == null ? null : String(row.chat_id),
    userId: row.user_id == null ? null : String(row.user_id),
    sessionLabel: row.session_label == null ? null : String(row.session_label),
    message: String(row.message ?? ""),
    stack: row.stack == null ? null : String(row.stack),
    context: parseContext(row.context),
  };
}

/** Query logs newest-first. Fire-and-forget safe; returns [] on failure. */
export function queryErrorLogs(query: ErrorLogQuery = {}): ErrorLogRow[] {
  try {
    ensureErrorLogsTable();
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (typeof query.since === "number" && Number.isFinite(query.since)) {
      conditions.push("ts >= ?");
      params.push(Math.trunc(query.since));
    }
    if (query.source && isErrorLogSource(query.source)) {
      conditions.push("source = ?");
      params.push(query.source);
    }
    if (query.level && isErrorLogLevel(query.level)) {
      conditions.push("level = ?");
      params.push(query.level);
    }
    if (query.chatId?.trim()) {
      conditions.push("chat_id = ?");
      params.push(query.chatId.trim());
    }
    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? 100) || 100, 1),
      1_000,
    );
    const rows = withSqliteRetry(() =>
      getDatabase()
        .prepare(
          `
          SELECT * FROM error_logs
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
          ORDER BY ts DESC, id DESC
          LIMIT ${limit}
        `,
        )
        .all(...params),
    ) as Array<Record<string, unknown>>;
    return rows.map(rowToEntry);
  } catch {
    return [];
  }
}

/** Get one full log entry (stack + context included). */
export function getErrorLogDetail(id: number): ErrorLogRow | null {
  try {
    if (!Number.isInteger(id) || id <= 0) return null;
    ensureErrorLogsTable();
    const row = withSqliteRetry(() =>
      getDatabase().prepare("SELECT * FROM error_logs WHERE id = ?").get(id),
    ) as Record<string, unknown> | undefined;
    return row ? rowToEntry(row) : null;
  } catch {
    return null;
  }
}

/** Prune logs older than keepDays. Fire-and-forget safe. */
export function pruneErrorLogs(keepDays = 14, now = Date.now()): number {
  try {
    ensureErrorLogsTable();
    const cutoff = now - Math.max(0, keepDays) * 86_400_000;
    return Number(
      withSqliteRetry(
        () =>
          getDatabase()
            .prepare("DELETE FROM error_logs WHERE ts < ?")
            .run(cutoff).changes,
      ),
    );
  } catch {
    return 0;
  }
}

/** Server-side catch-block helper for API routes. Never throws. */
export function captureApiError(
  route: string,
  error: unknown,
  req?: Request,
  extra: Record<string, unknown> = {},
): void {
  void logError({
    level: "error",
    source: "api",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context: {
      route,
      method: req?.method,
      url: req?.url?.slice(0, 2_000),
      ...extra,
    },
  });
}

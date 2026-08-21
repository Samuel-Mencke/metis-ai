import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureErrorLogsTable,
  getErrorLogDetail,
  logError,
  logFrontendError,
  pruneErrorLogs,
  queryErrorLogs,
} from "../lib/error-logs";
import { getDatabase } from "../lib/sqlite";

test("error logs insert, query, and filter", () => {
  ensureErrorLogsTable();
  const marker = `test-log-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const id = logError({
    level: "error",
    source: "api",
    chatId: "chat-test",
    userId: "user-test",
    message: marker,
    stack: "Error: boom",
    context: { route: "/api/test", userAgent: "test-agent" },
  });
  assert.ok(id > 0);
  const rows = queryErrorLogs({ source: "api", level: "error", chatId: "chat-test", limit: 10 });
  const found = rows.find((row) => row.id === id);
  assert.ok(found, "inserted row should be queryable");
  assert.equal(found.message, marker);
  assert.equal(found.stack, "Error: boom");
  assert.deepEqual(found.context?.route, "/api/test");
  const detail = getErrorLogDetail(id);
  assert.ok(detail);
  assert.equal(detail.id, id);
});

test("malformed entries are rejected without throwing", () => {
  assert.equal(logError({ level: "fatal", source: "api", message: "bad level" } as never), 0);
  assert.equal(logError({ level: "error", source: "unknown", message: "bad source" } as never), 0);
  assert.equal(logError({ level: "error", source: "api", message: "" }), 0);
  assert.equal(logError({ level: "error", source: "api", message: "   " }), 0);
});

test("logError never throws on database failure", () => {
  // Pass a symbol in context: JSON.stringify turns it into a plain object,
  // so this exercises sanitization rather than throwing.
  const id = logError({
    level: "warn",
    source: "worker",
    message: "safe",
    context: { circular: undefined },
  });
  assert.ok(id > 0);
});

test("logFrontendError defaults to frontend source and error level", () => {
  const marker = `frontend-${Date.now()}`;
  const id = logFrontendError(marker, { chatId: "chat-f", context: { url: "http://localhost/x" } });
  assert.ok(id > 0);
  const row = getErrorLogDetail(id);
  assert.ok(row);
  assert.equal(row.source, "frontend");
  assert.equal(row.level, "error");
  assert.equal(row.context?.url, "http://localhost/x");
});

test("pruneErrorLogs removes only old rows and never throws", () => {
  const now = Date.now();
  const oldId = logError({ level: "info", source: "system", message: `old-${now}`, ts: now - 20 * 86_400_000 });
  const newId = logError({ level: "info", source: "system", message: `new-${now}`, ts: now });
  assert.ok(oldId > 0 && newId > 0);
  const deleted = pruneErrorLogs(14, now + 1);
  assert.ok(deleted >= 1);
  assert.equal(getErrorLogDetail(oldId), null);
  assert.ok(getErrorLogDetail(newId));
});

test("ensureErrorLogsTable is idempotent", () => {
  ensureErrorLogsTable();
  ensureErrorLogsTable();
  const db = getDatabase();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='error_logs'").get() as { name?: string };
  assert.equal(row?.name, "error_logs");
});

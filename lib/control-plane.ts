import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getDatabase, transaction } from "@/lib/sqlite";
import { config } from "@/lib/config";

export type ControlRunState =
  | "queued"
  | "running"
  | "sleeping"
  | "completed"
  | "failed"
  | "cancelled";

export type ControlRun = {
  id: string;
  ownerId: string;
  clientId: string;
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
  state: ControlRunState;
  conversationId?: string;
  iteration: number;
  maxIterations: number;
  intervalSeconds: number;
  autoContinue: boolean;
  loopPrompt: string;
  stopMarker: string;
  resultText: string;
  error?: string;
  unread: boolean;
  cancelRequested: boolean;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
};

export type ControlEvent = {
  id: string;
  runId: string;
  ownerId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type ControlArtifact = {
  id: string;
  runId: string;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  storagePath: string;
  createdAt: string;
};

let initialized = false;
function ensureSchema() {
  if (initialized) return;
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS control_runs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES remote_clients(id) ON DELETE CASCADE,
      cwd TEXT NOT NULL,
      prompt TEXT NOT NULL,
      model TEXT,
      effort TEXT,
      state TEXT NOT NULL,
      conversation_id TEXT,
      iteration INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 1,
      interval_seconds INTEGER NOT NULL DEFAULT 15,
      auto_continue INTEGER NOT NULL DEFAULT 0,
      loop_prompt TEXT NOT NULL DEFAULT 'Continue the current task. Verify the real result and keep working until the goal is complete.',
      stop_marker TEXT NOT NULL DEFAULT 'METIS_LOOP_DONE',
      result_text TEXT NOT NULL DEFAULT '',
      error TEXT,
      unread INTEGER NOT NULL DEFAULT 0,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      next_run_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS control_runs_owner_state
      ON control_runs(owner_id, state, next_run_at, updated_at);
    CREATE TABLE IF NOT EXISTS control_instructions (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES control_runs(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS control_instructions_run
      ON control_instructions(run_id, consumed_at, created_at);
    CREATE TABLE IF NOT EXISTS control_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES control_runs(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS control_events_run
      ON control_events(run_id, created_at);
    CREATE TABLE IF NOT EXISTS control_artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES control_runs(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS control_artifacts_run
      ON control_artifacts(run_id, created_at);
  `);
  initialized = true;
}

function rowToRun(row: Record<string, unknown>): ControlRun {
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    clientId: String(row.client_id),
    cwd: String(row.cwd),
    prompt: String(row.prompt),
    model: row.model ? String(row.model) : undefined,
    effort: row.effort ? String(row.effort) : undefined,
    state: String(row.state) as ControlRunState,
    conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
    iteration: Number(row.iteration || 0),
    maxIterations: Number(row.max_iterations || 0),
    intervalSeconds: Number(row.interval_seconds || 15),
    autoContinue: Boolean(row.auto_continue),
    loopPrompt: String(row.loop_prompt || "Continue the current task."),
    stopMarker: String(row.stop_marker || "METIS_LOOP_DONE"),
    resultText: String(row.result_text || ""),
    error: row.error ? String(row.error) : undefined,
    unread: Boolean(row.unread),
    cancelRequested: Boolean(row.cancel_requested),
    nextRunAt: row.next_run_at ? String(row.next_run_at) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
  };
}

export function createControlRun(input: {
  ownerId: string;
  clientId: string;
  cwd: string;
  prompt: string;
  model?: string;
  effort?: string;
  autoContinue?: boolean;
  maxIterations?: number;
  intervalSeconds?: number;
  loopPrompt?: string;
  stopMarker?: string;
}) {
  ensureSchema();
  const now = new Date().toISOString();
  const id = randomUUID();
  const autoContinue = Boolean(input.autoContinue);
  const maxIterations = autoContinue
    ? Math.max(0, Math.min(Number(input.maxIterations ?? 50), 10_000))
    : 1;
  const intervalSeconds = Math.max(1, Math.min(Number(input.intervalSeconds ?? 15), 86_400));
  getDatabase().prepare(`
    INSERT INTO control_runs (
      id, owner_id, client_id, cwd, prompt, model, effort, state,
      iteration, max_iterations, interval_seconds, auto_continue,
      loop_prompt, stop_marker, result_text, unread, cancel_requested,
      next_run_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, '', 0, 0, ?, ?, ?)
  `).run(
    id,
    input.ownerId,
    input.clientId,
    input.cwd,
    input.prompt,
    input.model ?? null,
    input.effort ?? null,
    maxIterations,
    intervalSeconds,
    autoContinue ? 1 : 0,
    input.loopPrompt || "Continue the current task. Inspect the real state, verify what changed, and keep working until the requested goal is actually complete.",
    input.stopMarker || "METIS_LOOP_DONE",
    now,
    now,
    now,
  );
  appendControlEvent(id, input.ownerId, "queued", { clientId: input.clientId, autoContinue, maxIterations });
  return getControlRun(id, input.ownerId)!;
}

export function getControlRun(id: string, ownerId: string) {
  ensureSchema();
  const row = getDatabase().prepare("SELECT * FROM control_runs WHERE id = ? AND owner_id = ?").get(id, ownerId) as Record<string, unknown> | undefined;
  return row ? rowToRun(row) : null;
}

export function listControlRuns(ownerId: string, limit = 50) {
  ensureSchema();
  return (getDatabase().prepare("SELECT * FROM control_runs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?").all(ownerId, Math.max(1, Math.min(limit, 200))) as Array<Record<string, unknown>>).map(rowToRun);
}

export function listRunnableControlRuns(limit = 8) {
  ensureSchema();
  const now = new Date().toISOString();
  return (getDatabase().prepare(`
    SELECT * FROM control_runs
    WHERE cancel_requested = 0
      AND (state = 'queued' OR (state = 'sleeping' AND (next_run_at IS NULL OR next_run_at <= ?)))
    ORDER BY updated_at ASC
    LIMIT ?
  `).all(now, Math.max(1, Math.min(limit, 32))) as Array<Record<string, unknown>>).map(rowToRun);
}

export function updateControlRun(id: string, ownerId: string, patch: Partial<{
  state: ControlRunState;
  conversationId: string | null;
  iteration: number;
  resultText: string;
  error: string | null;
  unread: boolean;
  cancelRequested: boolean;
  nextRunAt: string | null;
  finishedAt: string | null;
}>) {
  ensureSchema();
  const fields: string[] = [];
  const values: unknown[] = [];
  const mapping: Record<string, string> = {
    state: "state",
    conversationId: "conversation_id",
    iteration: "iteration",
    resultText: "result_text",
    error: "error",
    unread: "unread",
    cancelRequested: "cancel_requested",
    nextRunAt: "next_run_at",
    finishedAt: "finished_at",
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (!(key in patch)) continue;
    fields.push(`${column} = ?`);
    const value = (patch as Record<string, unknown>)[key];
    values.push(typeof value === "boolean" ? (value ? 1 : 0) : value ?? null);
  }
  if (!fields.length) return getControlRun(id, ownerId);
  fields.push("updated_at = ?");
  values.push(new Date().toISOString(), id, ownerId);
  getDatabase().prepare(`UPDATE control_runs SET ${fields.join(", ")} WHERE id = ? AND owner_id = ?`).run(...values);
  return getControlRun(id, ownerId);
}

export function queueControlInstruction(runId: string, ownerId: string, prompt: string) {
  ensureSchema();
  const run = getControlRun(runId, ownerId);
  if (!run) throw new Error("Control run not found");
  const now = new Date().toISOString();
  getDatabase().prepare("INSERT INTO control_instructions (id, run_id, owner_id, prompt, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), runId, ownerId, prompt, now);
  if (["completed", "failed", "cancelled"].includes(run.state)) {
    updateControlRun(runId, ownerId, { state: "queued", unread: false, cancelRequested: false, error: null, finishedAt: null, nextRunAt: now });
  } else if (run.state === "sleeping") {
    updateControlRun(runId, ownerId, { nextRunAt: now });
  }
  appendControlEvent(runId, ownerId, "instruction", { prompt });
  return getControlRun(runId, ownerId);
}

export function consumeControlInstruction(runId: string, ownerId: string) {
  ensureSchema();
  return transaction(() => {
    const row = getDatabase().prepare(`
      SELECT id, prompt FROM control_instructions
      WHERE run_id = ? AND owner_id = ? AND consumed_at IS NULL
      ORDER BY created_at ASC LIMIT 1
    `).get(runId, ownerId) as { id: string; prompt: string } | undefined;
    if (!row) return null;
    getDatabase().prepare("UPDATE control_instructions SET consumed_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return row.prompt;
  });
}

export function appendControlEvent(runId: string, ownerId: string, type: string, data: Record<string, unknown> = {}) {
  ensureSchema();
  const event: ControlEvent = { id: randomUUID(), runId, ownerId, type, data, createdAt: new Date().toISOString() };
  getDatabase().prepare("INSERT INTO control_events (id, run_id, owner_id, type, data, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(event.id, event.runId, event.ownerId, event.type, JSON.stringify(event.data), event.createdAt);
  return event;
}

export function listControlEvents(runId: string, ownerId: string, limit = 200) {
  ensureSchema();
  const rows = getDatabase().prepare(`
    SELECT * FROM control_events WHERE run_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(runId, ownerId, Math.max(1, Math.min(limit, 1000))) as Array<Record<string, unknown>>;
  return rows.reverse().map((row) => ({
    id: String(row.id), runId: String(row.run_id), ownerId: String(row.owner_id), type: String(row.type),
    data: (() => { try { return JSON.parse(String(row.data || "{}")); } catch { return {}; } })(),
    createdAt: String(row.created_at),
  } satisfies ControlEvent));
}

export function requestControlCancel(runId: string, ownerId: string) {
  const run = getControlRun(runId, ownerId);
  if (!run) throw new Error("Control run not found");
  const terminal = run.state === "queued" || run.state === "sleeping";
  updateControlRun(runId, ownerId, {
    cancelRequested: true,
    ...(terminal ? { state: "cancelled" as const, unread: true, finishedAt: new Date().toISOString() } : {}),
  });
  appendControlEvent(runId, ownerId, "cancel_requested", {});
  return getControlRun(runId, ownerId);
}

export function listControlInbox(ownerId: string, limit = 50) {
  ensureSchema();
  return (getDatabase().prepare(`
    SELECT * FROM control_runs WHERE owner_id = ? AND unread = 1 ORDER BY updated_at DESC LIMIT ?
  `).all(ownerId, Math.max(1, Math.min(limit, 200))) as Array<Record<string, unknown>>).map(rowToRun);
}

export function acknowledgeControlRun(runId: string, ownerId: string) {
  return updateControlRun(runId, ownerId, { unread: false });
}

function artifactRoot() {
  const root = process.env.METIS_CONTROL_ARTIFACT_DIR?.trim() || path.join(config.dataDir, "control-artifacts");
  mkdirSync(root, { recursive: true });
  return root;
}

export function saveControlArtifact(input: { runId: string; ownerId: string; name: string; mimeType: string; data: Buffer }) {
  ensureSchema();
  const id = randomUUID();
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 160) || "artifact.bin";
  const dir = path.join(artifactRoot(), input.ownerId, input.runId);
  mkdirSync(dir, { recursive: true });
  const storagePath = path.join(dir, `${id}-${safeName}`);
  writeFileSync(storagePath, input.data);
  const createdAt = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO control_artifacts (id, run_id, owner_id, name, mime_type, size, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.runId, input.ownerId, safeName, input.mimeType, input.data.length, storagePath, createdAt);
  appendControlEvent(input.runId, input.ownerId, "artifact", { id, name: safeName, mimeType: input.mimeType, size: input.data.length });
  return { id, runId: input.runId, ownerId: input.ownerId, name: safeName, mimeType: input.mimeType, size: input.data.length, storagePath, createdAt } satisfies ControlArtifact;
}

export function listControlArtifacts(runId: string, ownerId: string) {
  ensureSchema();
  return (getDatabase().prepare("SELECT * FROM control_artifacts WHERE run_id = ? AND owner_id = ? ORDER BY created_at ASC").all(runId, ownerId) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id), runId: String(row.run_id), ownerId: String(row.owner_id), name: String(row.name), mimeType: String(row.mime_type), size: Number(row.size), storagePath: String(row.storage_path), createdAt: String(row.created_at),
  } satisfies ControlArtifact));
}

export function readControlArtifact(id: string, ownerId: string) {
  ensureSchema();
  const row = getDatabase().prepare("SELECT * FROM control_artifacts WHERE id = ? AND owner_id = ?").get(id, ownerId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const artifact = { id: String(row.id), runId: String(row.run_id), ownerId: String(row.owner_id), name: String(row.name), mimeType: String(row.mime_type), size: Number(row.size), storagePath: String(row.storage_path), createdAt: String(row.created_at) } satisfies ControlArtifact;
  return { artifact, data: readFileSync(artifact.storagePath) };
}

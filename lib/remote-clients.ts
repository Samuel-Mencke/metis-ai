import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getDatabase, isSqliteBusyError, transaction } from "@/lib/sqlite";

export type RemotePolicyMode = "restricted" | "approval_required" | "full_access";
export type RemoteClientStatus = "online" | "offline" | "revoked";
export type RemoteAction =
  | "get_info"
  | "list_directory"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "delete_file"
  | "execute_command"
  | "pty_open"
  | "pty_input"
  | "pty_resize"
  | "pty_close";

export type RemotePolicy = {
  mode: RemotePolicyMode;
  allowlist: string[];
};

export type RemoteClient = {
  id: string;
  ownerId: string;
  name: string;
  status: RemoteClientStatus;
  os?: string;
  architecture?: string;
  version?: string;
  hostname?: string;
  address?: string;
  capabilities: string[];
  policy: RemotePolicy;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type RemoteAuditEntry = {
  id: string;
  ownerId: string;
  clientId?: string;
  source: "user" | "agent" | "client";
  action: string;
  requestData: Record<string, unknown>;
  status: "requested" | "approved" | "completed" | "denied" | "error";
  error?: string;
  createdAt: string;
};

const iso = () => new Date().toISOString();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const REMOTE_SEEN_WRITE_INTERVAL_MS = 60_000;
const remoteSeenWrittenAt = new Map<string, number>();

function ignoreBusyTelemetry(error: unknown, operation: string) {
  if (!isSqliteBusyError(error)) throw error;
  console.warn(`[remote-client] sqlite busy; skipped ${operation}`);
}
const safeJson = <T>(value: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
};

function mapClient(row: Record<string, unknown>): RemoteClient {
  return {
    id: String(row.id),
    ownerId: String(row.ownerId),
    name: String(row.name),
    status: row.revokedAt ? "revoked" : (String(row.status) as RemoteClientStatus),
    ...(row.os ? { os: String(row.os) } : {}),
    ...(row.architecture ? { architecture: String(row.architecture) } : {}),
    ...(row.version ? { version: String(row.version) } : {}),
    ...(row.hostname ? { hostname: String(row.hostname) } : {}),
    ...(row.address ? { address: String(row.address) } : {}),
    capabilities: safeJson<string[]>(row.capabilities, []),
    policy: safeJson<RemotePolicy>(row.policy, { mode: "approval_required", allowlist: [] }),
    ...(row.lastSeenAt ? { lastSeenAt: String(row.lastSeenAt) } : {}),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    ...(row.revokedAt ? { revokedAt: String(row.revokedAt) } : {}),
  };
}

export function createEnrollmentToken(ownerId: string, ttlMs = 15 * 60 * 1000) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = iso();
  getDatabase().prepare(
    "INSERT INTO remote_enrollment_tokens (token_hash, owner_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(hash(token), ownerId, new Date(Date.now() + ttlMs).toISOString(), createdAt);
  return { token, expiresAt: new Date(Date.now() + ttlMs).toISOString() };
}

export function consumeEnrollmentToken(token: string) {
  return transaction(() => {
    const row = getDatabase().prepare(
      "SELECT token_hash as tokenHash, owner_id as ownerId, expires_at as expiresAt, used_at as usedAt FROM remote_enrollment_tokens WHERE token_hash = ?",
    ).get(hash(token)) as { tokenHash?: string; ownerId?: string; expiresAt?: string; usedAt?: string } | undefined;
    if (!row?.ownerId || row.usedAt || !row.expiresAt || new Date(row.expiresAt).getTime() <= Date.now()) return null;
    getDatabase().prepare("UPDATE remote_enrollment_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
      .run(iso(), row.tokenHash!);
    return { ownerId: row.ownerId };
  });
}

export function registerRemoteClient(token: string, input: {
  name?: string;
  os?: string;
  architecture?: string;
  version?: string;
  hostname?: string;
  capabilities?: string[];
}) {
  const enrollment = consumeEnrollmentToken(token);
  if (!enrollment) return null;
  const id = randomUUID();
  const credential = randomBytes(32).toString("base64url");
  const now = iso();
  getDatabase().prepare(
    `INSERT INTO remote_clients
      (id, owner_id, name, status, os, architecture, version, hostname, capabilities, policy, created_at, updated_at)
     VALUES (?, ?, ?, 'offline', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    enrollment.ownerId,
    input.name?.trim() || input.hostname?.trim() || "Remote client",
    input.os?.trim() || null,
    input.architecture?.trim() || null,
    input.version?.trim() || null,
    input.hostname?.trim() || null,
    JSON.stringify(input.capabilities?.slice(0, 64) || []),
    JSON.stringify({ mode: "approval_required", allowlist: [] } satisfies RemotePolicy),
    now,
    now,
  );
  getDatabase().prepare(
    "INSERT INTO remote_client_credentials (id, client_id, secret_hash, created_at) VALUES (?, ?, ?, ?)",
  ).run(randomUUID(), id, hash(credential), now);
  return { client: getRemoteClient(id, enrollment.ownerId), credential };
}

export function listRemoteClients(ownerId: string) {
  return (getDatabase().prepare(
    `SELECT id, owner_id as ownerId, name, status, os, architecture, version, hostname,
            address, capabilities, policy, last_seen_at as lastSeenAt, created_at as createdAt,
            updated_at as updatedAt, revoked_at as revokedAt
     FROM remote_clients WHERE owner_id = ? ORDER BY updated_at DESC`,
  ).all(ownerId) as Array<Record<string, unknown>>).map(mapClient);
}

export function getRemoteClient(id: string, ownerId?: string) {
  const row = getDatabase().prepare(
    `SELECT id, owner_id as ownerId, name, status, os, architecture, version, hostname,
            address, capabilities, policy, last_seen_at as lastSeenAt, created_at as createdAt,
            updated_at as updatedAt, revoked_at as revokedAt
     FROM remote_clients WHERE id = ? AND (? IS NULL OR owner_id = ?)`,
  ).get(id, ownerId ?? null, ownerId ?? null) as Record<string, unknown> | undefined;
  return row ? mapClient(row) : null;
}

export function authenticateRemoteClient(id: string, credential: string) {
  const row = getDatabase().prepare(
    `SELECT c.id, c.owner_id as ownerId, c.status, c.revoked_at as revokedAt,
            r.secret_hash as secretHash
     FROM remote_clients c JOIN remote_client_credentials r ON r.client_id = c.id
     WHERE c.id = ? AND r.revoked_at IS NULL
     ORDER BY r.created_at DESC LIMIT 1`,
  ).get(id) as { id?: string; ownerId?: string; status?: string; revokedAt?: string; secretHash?: string } | undefined;
  if (!row?.ownerId || row.revokedAt || !row.secretHash) return null;
  const actual = Buffer.from(hash(credential));
  const expected = Buffer.from(row.secretHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  const now = iso();
  try {
    getDatabase().prepare("UPDATE remote_client_credentials SET last_used_at = ? WHERE client_id = ? AND secret_hash = ?")
      .run(now, id, row.secretHash);
  } catch (error) {
    // Credential usage timestamps are telemetry. A busy database must not
    // reject an otherwise valid remote-client authentication.
    ignoreBusyTelemetry(error, "credential last-used update");
  }
  markRemoteClientSeen(id, undefined, true);
  return { clientId: id, ownerId: row.ownerId };
}

export function markRemoteClientSeen(id: string, address?: string, force = false) {
  const nowMs = Date.now();
  const lastWrittenAt = remoteSeenWrittenAt.get(id) || 0;
  if (!force && nowMs - lastWrittenAt < REMOTE_SEEN_WRITE_INTERVAL_MS) return false;
  const now = new Date(nowMs).toISOString();
  try {
    getDatabase().prepare(
      "UPDATE remote_clients SET status = 'online', last_seen_at = ?, address = COALESCE(?, address), updated_at = ? WHERE id = ? AND revoked_at IS NULL",
    ).run(now, address ?? null, now, id);
    remoteSeenWrittenAt.set(id, nowMs);
    return true;
  } catch (error) {
    // Heartbeats are advisory presence telemetry. Never let them become an
    // uncaught WebSocket exception or take down unrelated agent streams.
    ignoreBusyTelemetry(error, "heartbeat presence update");
    return false;
  }
}

export function markRemoteClientOffline(id: string) {
  remoteSeenWrittenAt.delete(id);
  try {
    getDatabase().prepare("UPDATE remote_clients SET status = 'offline', updated_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(iso(), id);
    return true;
  } catch (error) {
    // last_seen_at is still enough to detect stale clients if this best-effort
    // status write loses a race with another SQLite writer.
    ignoreBusyTelemetry(error, "offline presence update");
    return false;
  }
}

export function updateRemoteClient(id: string, ownerId: string, patch: {
  name?: string;
  policy?: RemotePolicy;
}) {
  const current = getRemoteClient(id, ownerId);
  if (!current) return null;
  const nextPolicy = patch.policy
    ? {
        mode: patch.policy.mode,
        allowlist: [...new Set(patch.policy.allowlist.map((item) => item.trim()).filter(Boolean))].slice(0, 100),
      }
    : current.policy;
  getDatabase().prepare(
    "UPDATE remote_clients SET name = ?, policy = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL",
  ).run(patch.name?.trim() || current.name, JSON.stringify(nextPolicy), iso(), id, ownerId);
  return getRemoteClient(id, ownerId);
}

export function revokeRemoteClient(id: string, ownerId: string) {
  const changed = getDatabase().prepare(
    "UPDATE remote_clients SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL",
  ).run(iso(), iso(), id, ownerId);
  getDatabase().prepare("UPDATE remote_client_credentials SET revoked_at = ? WHERE client_id = ? AND revoked_at IS NULL")
    .run(iso(), id);
  return changed.changes > 0;
}

export function deleteRemoteClient(id: string, ownerId: string) {
  const changed = getDatabase().prepare(
    "DELETE FROM remote_clients WHERE id = ? AND owner_id = ?",
  ).run(id, ownerId);
  return changed.changes > 0;
}

export function authorizeRemoteAction(client: RemoteClient, action: RemoteAction, command?: string) {
  if (client.status === "revoked") return { allowed: false, requiresApproval: false, reason: "Client is revoked" };
  if (client.policy.mode === "full_access") return { allowed: true, requiresApproval: false };
  const mutatesFiles = action === "write_file" || action === "edit_file" || action === "delete_file";
  if (mutatesFiles) {
    return client.policy.mode === "approval_required"
      ? { allowed: true, requiresApproval: true }
      : { allowed: false, requiresApproval: false, reason: "File changes are disabled by the client restricted policy" };
  }
  if (action !== "execute_command") return { allowed: true, requiresApproval: client.policy.mode === "approval_required" };
  const normalized = command?.trim() || "";
  const allowed = client.policy.allowlist.some((entry) => normalized === entry || normalized.startsWith(`${entry} `));
  if (client.policy.mode === "restricted") {
    return { allowed, requiresApproval: false, reason: allowed ? undefined : "Command is not in the client allowlist" };
  }
  return { allowed: true, requiresApproval: true };
}

export function appendRemoteAudit(input: Omit<RemoteAuditEntry, "id" | "createdAt">) {
  const entry = { ...input, id: randomUUID(), createdAt: iso() };
  getDatabase().prepare(
    "INSERT INTO remote_audit (id, owner_id, client_id, source, action, request_data, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    entry.id,
    entry.ownerId,
    entry.clientId ?? null,
    entry.source,
    entry.action,
    JSON.stringify(entry.requestData),
    entry.status,
    entry.error ?? null,
    entry.createdAt,
  );
  return entry;
}

export function listRemoteAudit(ownerId: string, clientId?: string) {
  return (getDatabase().prepare(
    `SELECT id, owner_id as ownerId, client_id as clientId, source, action, request_data as requestData,
            status, error, created_at as createdAt FROM remote_audit
     WHERE owner_id = ? AND (? IS NULL OR client_id = ?) ORDER BY created_at DESC LIMIT 200`,
  ).all(ownerId, clientId ?? null, clientId ?? null) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    ownerId: String(row.ownerId),
    ...(row.clientId ? { clientId: String(row.clientId) } : {}),
    source: String(row.source) as RemoteAuditEntry["source"],
    action: String(row.action),
    requestData: safeJson<Record<string, unknown>>(row.requestData, {}),
    status: String(row.status) as RemoteAuditEntry["status"],
    ...(row.error ? { error: String(row.error) } : {}),
    createdAt: String(row.createdAt),
  }));
}


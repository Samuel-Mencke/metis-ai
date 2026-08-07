import { randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/sqlite";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

export type OAuthFlowStatus =
  | "starting"
  | "awaiting_auth"
  | "awaiting_code"
  | "completed"
  | "error"
  | "cancelled";

export type OAuthFlow = {
  id: string;
  ownerId: string;
  connectionId: string;
  providerKey: string;
  status: OAuthFlowStatus;
  authUrl?: string;
  instructions?: string;
  userCode?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

type OAuthFlowRow = {
  id: string;
  owner_id: string;
  connection_id: string;
  provider_key: string;
  status: OAuthFlowStatus;
  auth_url?: string | null;
  instructions?: string | null;
  user_code?: string | null;
  manual_code?: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

function toFlow(row: OAuthFlowRow): OAuthFlow {
  return {
    id: row.id,
    ownerId: row.owner_id,
    connectionId: row.connection_id,
    providerKey: row.provider_key,
    status: row.status,
    ...(row.auth_url ? { authUrl: row.auth_url } : {}),
    ...(row.instructions ? { instructions: row.instructions } : {}),
    ...(row.user_code ? { userCode: row.user_code } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRow(id: string, ownerId: string) {
  return getDatabase().prepare(
    `SELECT id, owner_id, connection_id, provider_key, status,
            auth_url, instructions, user_code, manual_code, error, created_at, updated_at
     FROM provider_oauth_flows
     WHERE id = ? AND owner_id = ?`,
  ).get(id, ownerId) as OAuthFlowRow | undefined;
}

export function createOAuthFlow(input: {
  ownerId: string;
  connectionId: string;
  providerKey: string;
}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDatabase().prepare(
    `INSERT INTO provider_oauth_flows
      (id, owner_id, connection_id, provider_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'starting', ?, ?)`,
  ).run(id, input.ownerId, input.connectionId, input.providerKey, now, now);
  return getOAuthFlow(id, input.ownerId)!;
}

export function getOAuthFlow(id: string, ownerId: string) {
  const row = getRow(id, ownerId);
  return row ? toFlow(row) : null;
}

export function updateOAuthFlow(
  id: string,
  ownerId: string,
  patch: Partial<Pick<OAuthFlow, "status" | "authUrl" | "instructions" | "userCode" | "error">> & {
    manualCode?: string | null;
  },
) {
  const current = getRow(id, ownerId);
  if (!current) return null;
  const now = new Date().toISOString();
  getDatabase().prepare(
    `UPDATE provider_oauth_flows
     SET status = ?, auth_url = ?, instructions = ?, user_code = ?, manual_code = ?, error = ?, updated_at = ?
     WHERE id = ? AND owner_id = ?`,
  ).run(
    patch.status || current.status,
    patch.authUrl === undefined ? current.auth_url ?? null : patch.authUrl || null,
    patch.instructions === undefined ? current.instructions ?? null : patch.instructions || null,
    patch.userCode === undefined ? current.user_code ?? null : patch.userCode || null,
    patch.manualCode === undefined ? current.manual_code ?? null : patch.manualCode || null,
    patch.error === undefined ? current.error ?? null : patch.error || null,
    now,
    id,
    ownerId,
  );
  return getOAuthFlow(id, ownerId);
}

export function submitOAuthManualCode(id: string, ownerId: string, code: string) {
  if (!code.trim()) return null;
  return updateOAuthFlow(id, ownerId, {
    status: "awaiting_code",
    manualCode: encryptSecret(code.trim().slice(0, 4_000)),
  });
}

export function consumeOAuthManualCode(id: string, ownerId: string) {
  const row = getRow(id, ownerId);
  if (!row?.manual_code) return null;
  getDatabase().prepare(
    "UPDATE provider_oauth_flows SET manual_code = NULL, updated_at = ? WHERE id = ? AND owner_id = ?",
  ).run(new Date().toISOString(), id, ownerId);
  try {
    return decryptSecret(row.manual_code);
  } catch {
    return null;
  }
}

import { createHash } from "node:crypto";
import { getDatabase, transaction } from "@/lib/sqlite";

export type CapabilityCategory =
  | "read"
  | "write"
  | "terminal"
  | "browser"
  | "memory"
  | "remote"
  | "plan"
  | "subagent";

export type CapabilityManifest = {
  version: 1;
  policyVersion: string;
  ownerId: string;
  workspaceId: string;
  runId: string;
  attemptId: string;
  allowedCategories: CapabilityCategory[];
  toolOverrides: Record<string, boolean>;
  childMcpGrants: Record<string, string[]>;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown) {
  return JSON.stringify(stableValue(value));
}

export function capabilityManifestHash(manifest: CapabilityManifest) {
  return createHash("sha256").update(stableJson(manifest)).digest("hex");
}

export function createCapabilityManifest(input: {
  ownerId: string;
  workspaceId: string;
  runId: string;
  attemptId?: string;
  policyVersion?: string;
  allowedCategories: readonly CapabilityCategory[];
  toolOverrides?: Record<string, boolean>;
  childMcpGrants?: Record<string, readonly string[]>;
}): CapabilityManifest {
  return {
    version: 1,
    policyVersion: input.policyVersion || "mode-policy-v1",
    ownerId: input.ownerId,
    workspaceId: input.workspaceId || "default",
    runId: input.runId,
    attemptId: input.attemptId || input.runId,
    allowedCategories: [...new Set(input.allowedCategories)].sort(),
    toolOverrides: Object.fromEntries(
      Object.entries(input.toolOverrides || {})
        .filter(([name]) => name.trim())
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
    childMcpGrants: Object.fromEntries(
      Object.entries(input.childMcpGrants || {})
        .filter(([server]) => server.trim())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([server, tools]) => [
          server,
          [...new Set(tools.filter((tool) => tool.trim()))].sort(),
        ]),
    ),
  };
}

export function persistCapabilityManifest(manifest: CapabilityManifest): CapabilityManifest {
  const serialized = stableJson(manifest);
  const digest = capabilityManifestHash(manifest);
  const now = new Date().toISOString();
  return transaction(() => {
    const db = getDatabase();
    const existing = db.prepare(
      `SELECT manifest_json as manifestJson, manifest_hash as manifestHash
       FROM capability_manifests
       WHERE owner_id = ? AND run_id = ? AND attempt_id = ?`,
    ).get(manifest.ownerId, manifest.runId, manifest.attemptId) as
      | { manifestJson: string; manifestHash: string }
      | undefined;
    if (existing && existing.manifestHash !== digest) {
      const previous = JSON.parse(existing.manifestJson) as CapabilityManifest;
      const previousGrants = previous.childMcpGrants || {};
      const requestedWildcard = manifest.childMcpGrants["*"];
      if (
        Object.keys(previousGrants).length === 0 &&
        Array.isArray(requestedWildcard) &&
        requestedWildcard.includes("*")
      ) {
        db.prepare(
          `UPDATE capability_manifests
           SET manifest_json = ?, manifest_hash = ?
           WHERE owner_id = ? AND run_id = ? AND attempt_id = ?`,
        ).run(serialized, digest, manifest.ownerId, manifest.runId, manifest.attemptId);
        return manifest;
      }
      throw new Error("Capability manifest is immutable for this run attempt");
    }
    db.prepare(
      `INSERT OR IGNORE INTO capability_manifests
       (owner_id, run_id, attempt_id, manifest_json, manifest_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(manifest.ownerId, manifest.runId, manifest.attemptId, serialized, digest, now);
    return existing ? JSON.parse(existing.manifestJson) as CapabilityManifest : manifest;
  });
}

export function getCapabilityManifest(ownerId: string, runId: string, attemptId: string) {
  const row = getDatabase().prepare(
    `SELECT manifest_json as manifestJson, manifest_hash as manifestHash
     FROM capability_manifests
     WHERE owner_id = ? AND run_id = ? AND attempt_id = ?`,
  ).get(ownerId, runId, attemptId) as
    | { manifestJson: string; manifestHash: string }
    | undefined;
  if (!row) return null;
  const manifest = JSON.parse(row.manifestJson) as CapabilityManifest;
  if (capabilityManifestHash(manifest) !== row.manifestHash) {
    throw new Error("Stored capability manifest hash mismatch");
  }
  return manifest;
}

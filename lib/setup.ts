import { getDatabase } from "@/lib/sqlite";
import { listChatProviderConnections } from "@/lib/provider-connections";

const SETUP_META_KEY = "setup_complete";

export type SetupStatus = {
  needed: boolean;
  hasUsers: boolean;
  setupComplete: boolean;
  hasProvider: boolean;
};

function userCount() {
  return Number((getDatabase().prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count);
}

function metaValue(key: string) {
  const row = getDatabase().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

export function isSetupComplete() {
  const flagged = metaValue(SETUP_META_KEY);
  if (flagged === "1") return true;
  if (flagged === "0") return false;
  // Existing installs already have users; do not lock the owner behind first-run.
  return userCount() > 0;
}

export function markSetupComplete() {
  getDatabase().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(SETUP_META_KEY, "1");
}

export function markSetupIncomplete() {
  getDatabase().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(SETUP_META_KEY, "0");
}

export function getSetupStatus(ownerId?: string): SetupStatus {
  const hasUsers = userCount() > 0;
  const setupComplete = isSetupComplete();
  const hasProvider = ownerId
    ? listChatProviderConnections(ownerId, false).length > 0
    : false;
  return {
    hasUsers,
    setupComplete,
    hasProvider,
    needed: !setupComplete,
  };
}

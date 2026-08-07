import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID, pbkdf2Sync, randomBytes } from "node:crypto";
import { config } from "@/lib/config";

const dataDir = config.dataDir;
export const databasePath = config.databasePath;

let database: DatabaseSync | undefined;

function json<T>(file: string, fallback: T): T {
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : fallback;
  } catch {
    return fallback;
  }
}

function atomicJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.migration`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, file);
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  return `${salt}:${pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex")}`;
}

function syncLegacyMemories(db: DatabaseSync, memoriesPath: string, ownerId?: string) {
  const insertMemory = db.prepare(
    "INSERT OR IGNORE INTO memories (id, owner_id, data, updated_at) VALUES (?, ?, ?, ?)",
  );
  for (const memory of json<Array<Record<string, unknown>>>(memoriesPath, [])) {
    if (typeof memory.id === "string") {
      insertMemory.run(
        memory.id,
        ownerId ?? null,
        JSON.stringify(memory),
        typeof memory.updatedAt === "string" ? memory.updatedAt : new Date().toISOString(),
      );
    }
  }
}

function migrateLegacy(db: DatabaseSync) {
  const hasMigration = db.prepare("SELECT value FROM meta WHERE key = 'json_migrated'").get();
  const userCount = Number((db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number }).count);
  const ownerMigration = db.prepare("SELECT value FROM meta WHERE key = 'legacy_owner_assigned'").get();
  const usersPath = path.join(dataDir, "users.json");
  const sessionsPath = path.join(dataDir, "sessions.json");
  const chatsDir = path.join(dataDir, "chats");
  const memoriesPath = path.join(dataDir, "memories.json");
  const settingsPath = path.join(dataDir, "settings.json");
  if (hasMigration && userCount > 0 && ownerMigration) {
    // SQLite is canonical after migration. Do not re-import the legacy JSON
    // snapshot on every process initialization, otherwise deleted memories
    // would be resurrected on the next reload.
    return;
  }

  const users = json<Array<{ id: string; username: string; passwordHash: string; createdAt: string }>>(
    usersPath,
    [],
  );
  if (!users.length && process.env.CHAT_PASSWORD?.trim()) {
    users.push({
      id: randomUUID(),
      username: config.chatUsername,
      passwordHash: hashPassword(process.env.CHAT_PASSWORD.trim()),
      createdAt: new Date().toISOString(),
    });
  }
  const initialUser = users[0] || (db.prepare(
    "SELECT id, username, password_hash as passwordHash, created_at as createdAt FROM users ORDER BY created_at ASC LIMIT 1",
  ).get() as { id: string; username: string; passwordHash: string; createdAt: string } | undefined);
  const insertUser = db.prepare(
    "INSERT OR IGNORE INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
  );
  for (const user of users) {
    insertUser.run(user.id, user.username, user.passwordHash, user.createdAt);
  }
  const sessions = json<Array<{ tokenHash: string; userId: string; expiresAt: string }>>(
    sessionsPath,
    [],
  );
  const insertSession = db.prepare(
    "INSERT OR IGNORE INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  );
  for (const session of sessions) {
    insertSession.run(session.tokenHash, session.userId, session.expiresAt);
  }

  const index = json<Array<Record<string, unknown>>>(path.join(chatsDir, "index.json"), []);
  const insertChat = db.prepare(
    "INSERT OR IGNORE INTO chats (id, owner_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  for (const entry of index) {
    if (typeof entry.id !== "string") continue;
    const file = path.join(chatsDir, `${entry.id}.json`);
    const chat = json<Record<string, unknown> | null>(file, null);
    if (!chat) continue;
    const ownerId =
      typeof chat.ownerId === "string"
        ? chat.ownerId
        : typeof entry.ownerId === "string"
          ? entry.ownerId
          : initialUser?.id;
    if (ownerId && !chat.ownerId) chat.ownerId = ownerId;
    const createdAt =
      typeof chat.createdAt === "string" ? chat.createdAt : new Date().toISOString();
    const updatedAt =
      typeof chat.updatedAt === "string" ? chat.updatedAt : createdAt;
    insertChat.run(String(chat.id), typeof ownerId === "string" ? ownerId : null, JSON.stringify(chat), createdAt, updatedAt);
  }

  const ownerId = (db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id?: string } | undefined)?.id;
  syncLegacyMemories(db, memoriesPath, ownerId);
  const settings = json<Record<string, unknown>>(settingsPath, {});
  db.prepare("INSERT OR REPLACE INTO settings (key, owner_id, data) VALUES (?, ?, ?)").run(
    ownerId ? `global:${ownerId}` : "global",
    ownerId ?? null,
    JSON.stringify(settings),
  );
  if (ownerId && !db.prepare("SELECT value FROM meta WHERE key = 'legacy_owner_assigned'").get()) {
    const legacyChats = db.prepare("SELECT id, data FROM chats WHERE owner_id IS NULL").all() as Array<{ id: string; data: string }>;
    const assign = db.prepare("UPDATE chats SET owner_id = ?, data = ? WHERE id = ?");
    for (const row of legacyChats) {
      try {
        const chat = JSON.parse(row.data) as Record<string, unknown>;
        chat.ownerId = ownerId;
        assign.run(ownerId, JSON.stringify(chat), row.id);
      } catch {
        assign.run(ownerId, row.data, row.id);
      }
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_owner_assigned', '1')").run();
  }
  if (ownerId) {
    db.prepare("UPDATE memories SET owner_id = ? WHERE owner_id IS NULL").run(ownerId);
    db.prepare("UPDATE settings SET owner_id = ? WHERE owner_id IS NULL").run(ownerId);
  }
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('json_migrated', '1')").run();

  // Keep a readable backup marker so operators can verify that migration happened.
  const marker = path.join(dataDir, "sqlite-migration.json");
  if (!existsSync(marker)) {
    atomicJson(marker, { migratedAt: new Date().toISOString(), databasePath });
  }
}

export function getDatabase(): DatabaseSync {
  if (database) return database;
  mkdirSync(path.dirname(databasePath), { recursive: true });
  database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 10000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_model_permissions (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, model_id)
    );
    CREATE INDEX IF NOT EXISTS user_model_permissions_model
      ON user_model_permissions(model_id);
    CREATE TABLE IF NOT EXISTS provider_connections (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider_key TEXT NOT NULL,
      slug TEXT NOT NULL,
      label TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      base_url TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      secret_blob TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      last_checked_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_id, slug)
    );
    CREATE INDEX IF NOT EXISTS provider_connections_owner
      ON provider_connections(owner_id, enabled, provider_key);
    CREATE TABLE IF NOT EXISTS provider_models (
      connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
      canonical_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      discovered_at TEXT NOT NULL,
      PRIMARY KEY (connection_id, canonical_id)
    );
    CREATE INDEX IF NOT EXISTS provider_models_connection
      ON provider_models(connection_id, discovered_at DESC);
    CREATE TABLE IF NOT EXISTS provider_oauth_flows (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      connection_id TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
      provider_key TEXT NOT NULL,
      status TEXT NOT NULL,
      auth_url TEXT,
      instructions TEXT,
      manual_code TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS provider_oauth_flows_owner
      ON provider_oauth_flows(owner_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS chats_owner_updated ON chats(owner_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, updated_at);
    CREATE TABLE IF NOT EXISTS run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS run_events_chat_id ON run_events(chat_id, id);
    CREATE TABLE IF NOT EXISTS pending_questions (
      question_id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  for (const statement of [
    "ALTER TABLE memories ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE settings ADD COLUMN owner_id TEXT REFERENCES users(id) ON DELETE CASCADE",
    "ALTER TABLE provider_oauth_flows ADD COLUMN user_code TEXT",
  ]) {
    try {
      database.exec(statement);
    } catch {
      // Columns already exist on databases created with the account-aware schema.
    }
  }
  migrateLegacy(database);
  database.prepare(
    "INSERT OR IGNORE INTO meta (key, value) VALUES ('provider_connections_schema', '1')",
  ).run();
  database.prepare(
    `INSERT OR IGNORE INTO user_model_permissions (user_id, model_id, created_at)
     SELECT id, '*', ? FROM users`,
  ).run(new Date().toISOString());
  return database;
}

export function transaction<T>(fn: () => T): T {
  const db = getDatabase();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function parseData<T>(row: unknown): T | null {
  if (!row || typeof row !== "object" || !("data" in row)) return null;
  try {
    return JSON.parse(String((row as { data: unknown }).data)) as T;
  } catch {
    return null;
  }
}

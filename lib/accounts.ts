import { pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";
import { getDatabase } from "@/lib/sqlite";

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex")}`;
}

export function createAccount(username: string, password: string) {
  const clean = username.trim();
  if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(clean) || password.length < 8) return null;
  const user = { id: randomUUID(), username: clean, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
  try {
    getDatabase().prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(user.id, user.username, user.passwordHash, user.createdAt);
    return { id: user.id, username: user.username, createdAt: user.createdAt };
  } catch {
    return null;
  }
}

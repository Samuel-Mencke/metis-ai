import { createDecipheriv, createCipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function getMasterKey() {
  const encoded = process.env.AI_CHAT_SECRETS_KEY?.trim();
  if (!encoded) {
    throw new Error(
      "AI_CHAT_SECRETS_KEY is not configured. Set a 32-byte hex or base64 key before saving provider credentials.",
    );
  }

  if (/^[0-9a-f]{64}$/i.test(encoded)) {
    return Buffer.from(encoded, "hex");
  }

  let decoded: Buffer;
  try {
    decoded = Buffer.from(encoded, "base64");
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length !== 32) {
    throw new Error("AI_CHAT_SECRETS_KEY must decode to exactly 32 bytes.");
  }
  return decoded;
}

export function canEncryptSecrets() {
  const encoded = process.env.AI_CHAT_SECRETS_KEY?.trim();
  if (!encoded) return false;
  if (/^[0-9a-f]{64}$/i.test(encoded)) return true;
  try {
    return Buffer.from(encoded, "base64").length === 32;
  } catch {
    return false;
  }
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSecret(blob: string) {
  const [version, ivValue, tagValue, ciphertextValue] = blob.split(":");
  if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted credential format.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  const clean = value.trim();
  if (!clean) return null;
  if (clean.length <= 8) return "••••••••";
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

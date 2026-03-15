/**
 * Simple AES-256-GCM encryption for connection credentials.
 * Uses ENCRYPTION_KEY env var (32 bytes hex or base64).
 * Per handoff: one master encryption key in Vercel env vars.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      "ENCRYPTION_KEY must be set (32+ chars) for credential encryption"
    );
  }
  return scryptSync(raw, "scholarship-review-platform", KEY_LENGTH);
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivHex, tagHex, encrypted] = ciphertext.split(":");
  if (!ivHex || !tagHex || !encrypted) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
}

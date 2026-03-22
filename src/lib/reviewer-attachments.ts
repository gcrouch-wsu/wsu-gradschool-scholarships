import { createHmac, timingSafeEqual } from "crypto";
import { query } from "./db";

const DEV_HMAC_SECRET = "dev-secret";
const DEFAULT_SIGNED_URL_TTL_MS = 5 * 60 * 1000;
const REVIEWER_ATTACHMENT_FILENAME_SAFE_CHARS = /[^A-Za-z0-9._-]+/g;
const REVIEWER_ATTACHMENT_PATH_SAFE_CHARS = /[^A-Za-z0-9_-]+/g;

export const MAX_REVIEWER_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024;

function getHmacKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY is required");
    }
    return DEV_HMAC_SECRET;
  }
  return key;
}

function signValue(value: string): string {
  return createHmac("sha256", getHmacKey()).update(value).digest("hex");
}

function safeCompareHex(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function sanitizeBlobFilename(filename: string): string {
  const trimmed = filename.trim();
  const fallback = "attachment";
  const lastDot = trimmed.lastIndexOf(".");
  const rawBase = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const rawExt = lastDot > 0 ? trimmed.slice(lastDot + 1) : "";
  const base = rawBase.replace(REVIEWER_ATTACHMENT_FILENAME_SAFE_CHARS, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || fallback;
  const ext = rawExt.replace(/[^A-Za-z0-9]+/g, "").slice(0, 12);
  return ext ? `${base}.${ext}` : base;
}

function sanitizePathSegment(value: string): string {
  return value.trim().replace(REVIEWER_ATTACHMENT_PATH_SAFE_CHARS, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "upload";
}

export function buildReviewerAttachmentBlobPath(
  cycleId: string,
  rowId: number,
  userId: string,
  filename: string,
  uploadId: string
): string {
  return `reviewer-attachments/${cycleId}/${rowId}/${sanitizePathSegment(userId)}/${sanitizePathSegment(uploadId)}-${sanitizeBlobFilename(filename)}`;
}

export function createSignedReviewerFileUrl(
  fileId: string,
  expiresAt = Date.now() + DEFAULT_SIGNED_URL_TTL_MS
): string {
  const signature = signValue(`reviewer-file:${fileId}:${expiresAt}`);
  return `/api/reviewer-files/${fileId}?expires=${expiresAt}&signature=${signature}`;
}

export function verifySignedReviewerFileUrl(fileId: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = signValue(`reviewer-file:${fileId}:${expiresAt}`);
  return safeCompareHex(expected, signature.toLowerCase());
}

export async function getReviewerAttachmentSchemaStatus(): Promise<{ available: boolean }> {
  const { rows } = await query<{ available: boolean }>(
    "SELECT to_regclass('public.reviewer_row_files') IS NOT NULL AS available"
  );
  return { available: rows[0]?.available === true };
}

export function formatReviewerAttachmentSchemaUnavailableMessage(): string {
  return "Reviewer attachment uploads are unavailable until migration 006_reviewer_row_files.sql is applied.";
}

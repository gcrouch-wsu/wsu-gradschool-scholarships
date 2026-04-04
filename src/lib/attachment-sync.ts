import { Readable } from "node:stream";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { sanitizeSyncErrorForStorage } from "@/lib/sanitize-sync-error";
import { MAX_SMARTSHEET_MIRROR_FILE_BYTES } from "@/lib/intake";
import {
  attachFileToRowFromReadable,
  getRowAttachments,
  smartsheetAttachmentMatchesSize,
} from "@/lib/smartsheet";

/** Cap total files processed in one cron invocation to reduce Vercel timeout risk */
export const SYNC_MAX_FILES_PER_RUN = 20;
export const STALE_SYNCING_MINUTES = 10;

/** Bounded Node readable from a Web ReadableStream (avoids buffering full file in RAM). */
export function webStreamToNodeReadableMaxBytes(webStream: unknown, maxBytes: number): Readable {
  if (typeof webStream !== "object" || webStream === null || !("getReader" in webStream)) {
    throw new Error("webStreamToNodeReadableMaxBytes: expected a ReadableStream");
  }
  const reader = (
    webStream as {
      getReader(): {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(reason?: unknown): Promise<void>;
        releaseLock(): void;
      };
    }
  ).getReader();
  let total = 0;
  return Readable.from(
    (async function* () {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel();
              throw new Error(`attachment exceeds ${maxBytes} bytes`);
            }
            yield Buffer.from(value);
          }
        }
      } finally {
        reader.releaseLock();
      }
    })()
  );
}

export interface PendingFileRow {
  id: string;
  submission_id: string;
  cycle_id: string;
  field_key: string;
  blob_url: string;
  blob_pathname: string;
  original_filename: string;
  content_type: string;
  size_bytes: string | number;
  smartsheet_row_id: string | number | null;
  attachment_sync_status: string;
  sync_attempt_count: number;
  smartsheet_attachment_id: string | number | null;
  connection_id: string;
  sheet_id: number;
}

export async function resetStaleSyncingJobs(): Promise<number> {
  const { rowCount } = await query(
    `UPDATE intake_submission_files
     SET attachment_sync_status = 'retryable_failed',
         sync_error_json = jsonb_build_object('error', 'stale syncing reset by worker')
     WHERE attachment_sync_status = 'syncing'
       AND last_sync_attempt_at IS NOT NULL
       AND last_sync_attempt_at < now() - ($1 * interval '1 minute')`,
    [STALE_SYNCING_MINUTES]
  );
  return rowCount ?? 0;
}

function retryDelayMinutesAfterFailure(attemptCountAfterClaim: number): number | null {
  if (attemptCountAfterClaim >= 4) return null;
  if (attemptCountAfterClaim === 1) return 5;
  if (attemptCountAfterClaim === 2) return 30;
  return 120;
}

function isRetryableSmartsheetFailure(httpStatus?: number, errorCode?: number): boolean {
  if (httpStatus === 429) return true;
  if (errorCode === 4003) return true;
  if (httpStatus !== undefined && httpStatus >= 500) return true;
  return false;
}

function isPermanentClientError(httpStatus?: number): boolean {
  if (httpStatus === undefined) return false;
  if (httpStatus === 429) return false;
  if (httpStatus >= 500) return false;
  if (httpStatus === 404) return true;
  return httpStatus >= 400;
}

export async function claimFileRow(fileId: string): Promise<PendingFileRow | null> {
  const { rows } = await query<PendingFileRow>(
    `UPDATE intake_submission_files isf
     SET attachment_sync_status = 'syncing',
         last_sync_attempt_at = now(),
         sync_attempt_count = sync_attempt_count + 1
     FROM scholarship_cycles c
     WHERE isf.id = $1::uuid
       AND isf.cycle_id = c.id
       AND isf.attachment_sync_status IN ('pending', 'retryable_failed')
       AND (isf.next_sync_attempt_at IS NULL OR isf.next_sync_attempt_at <= now())
       AND isf.smartsheet_row_id IS NOT NULL
     RETURNING isf.id, isf.submission_id, isf.cycle_id, isf.field_key, isf.blob_url, isf.blob_pathname,
       isf.original_filename, isf.content_type, isf.size_bytes, isf.smartsheet_row_id,
       isf.attachment_sync_status, isf.sync_attempt_count, isf.smartsheet_attachment_id,
       c.connection_id, c.sheet_id::bigint AS sheet_id`,
    [fileId]
  );
  return rows[0] ?? null;
}

export async function markFilePermanentFailed(
  fileId: string,
  error: string,
  httpStatus?: number,
  errorCode?: number
): Promise<void> {
  await query(
    `UPDATE intake_submission_files
     SET attachment_sync_status = 'permanent_failed',
         sync_error_json = $2::jsonb,
         next_sync_attempt_at = NULL
     WHERE id = $1::uuid`,
    [
      fileId,
      JSON.stringify({ error, httpStatus, errorCode }),
    ]
  );
}

export async function markFileRetryable(
  fileId: string,
  error: string,
  attemptAfterClaim: number,
  httpStatus?: number,
  errorCode?: number
): Promise<void> {
  const delayMin = retryDelayMinutesAfterFailure(attemptAfterClaim);
  if (delayMin === null) {
    await markFilePermanentFailed(fileId, error || "max attempts", httpStatus, errorCode);
    return;
  }
  const safeError = sanitizeSyncErrorForStorage(error);
  await query(
    `UPDATE intake_submission_files
     SET attachment_sync_status = 'retryable_failed',
         sync_error_json = $2::jsonb,
         next_sync_attempt_at = now() + ($3 * interval '1 minute')
     WHERE id = $1::uuid`,
    [fileId, JSON.stringify({ error: safeError, httpStatus, errorCode }), delayMin]
  );
}

export async function markFileSyncedFromDedup(
  fileId: string,
  attachmentId: number,
  attachmentName: string
): Promise<void> {
  await query(
    `UPDATE intake_submission_files
     SET attachment_sync_status = 'synced',
         smartsheet_attachment_id = $2,
         smartsheet_attachment_name = $3,
         synced_at = now(),
         sync_error_json = NULL,
         blob_delete_after = now() + interval '24 hours',
         next_sync_attempt_at = NULL
     WHERE id = $1::uuid`,
    [fileId, attachmentId, attachmentName]
  );
}

export async function markFileSyncedAfterUpload(
  fileId: string,
  attachmentId: number,
  attachmentName: string
): Promise<void> {
  await markFileSyncedFromDedup(fileId, attachmentId, attachmentName);
}

export async function processAttachmentFile(fileId: string): Promise<{ ok: boolean; error?: string }> {
  const row = await claimFileRow(fileId);
  if (!row) {
    return { ok: true };
  }

  const rowId = typeof row.smartsheet_row_id === "string"
    ? parseInt(row.smartsheet_row_id, 10)
    : Number(row.smartsheet_row_id);
  if (!Number.isFinite(rowId)) {
    await markFilePermanentFailed(fileId, "Missing Smartsheet row id");
    return { ok: false, error: "bad row" };
  }

  const sheetId = Number(row.sheet_id);
  if (!Number.isFinite(sheetId)) {
    await markFilePermanentFailed(fileId, "Invalid sheet id on cycle");
    return { ok: false, error: "sheet" };
  }

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [row.connection_id]
  );
  const enc = conn[0]?.encrypted_credentials;
  if (!enc) {
    await markFileRetryable(fileId, "Connection credentials missing", row.sync_attempt_count, undefined, undefined);
    return { ok: false, error: "no credentials" };
  }

  let token: string;
  try {
    token = decrypt(enc);
  } catch {
    await markFileRetryable(fileId, "Could not decrypt connection token", row.sync_attempt_count);
    return { ok: false, error: "decrypt" };
  }

  if (row.smartsheet_attachment_id != null) {
    const existingId =
      typeof row.smartsheet_attachment_id === "string"
        ? parseInt(row.smartsheet_attachment_id, 10)
        : Number(row.smartsheet_attachment_id);
    if (Number.isFinite(existingId)) {
      await markFileSyncedFromDedup(fileId, existingId, row.original_filename);
      return { ok: true };
    }
  }

  const sizeBytes =
    typeof row.size_bytes === "string" ? parseInt(row.size_bytes, 10) : Number(row.size_bytes);

  const list = await getRowAttachments(token, sheetId, rowId);
  if (!list.ok) {
    const st = list.httpStatus;
    if (st === 404) {
      await markFilePermanentFailed(fileId, list.error ?? "row not found", 404);
    } else if (isRetryableSmartsheetFailure(st, undefined)) {
      await markFileRetryable(fileId, list.error ?? "list attachments failed", row.sync_attempt_count, st);
    } else if (isPermanentClientError(st)) {
      await markFilePermanentFailed(fileId, list.error ?? "list attachments failed", st);
    } else {
      await markFileRetryable(fileId, list.error ?? "list attachments failed", row.sync_attempt_count, st);
    }
    return { ok: false, error: list.error };
  }

  const match = list.attachments?.find(
    (a) =>
      a.name === row.original_filename && smartsheetAttachmentMatchesSize(a.sizeInKb, sizeBytes)
  );
  if (match) {
    await markFileSyncedFromDedup(fileId, match.id, match.name);
    return { ok: true };
  }

  const blobRes = await fetch(row.blob_url, {
    headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    signal: AbortSignal.timeout(120_000),
  });
  if (!blobRes.ok) {
    if (blobRes.status === 404) {
      await markFilePermanentFailed(fileId, "Blob object missing", blobRes.status);
    } else {
      await markFileRetryable(fileId, `Blob fetch failed: ${blobRes.status}`, row.sync_attempt_count, blobRes.status);
    }
    return { ok: false, error: "blob" };
  }

  const contentLength = blobRes.headers.get("content-length");
  if (contentLength) {
    const n = parseInt(contentLength, 10);
    if (Number.isFinite(n) && n > MAX_SMARTSHEET_MIRROR_FILE_BYTES) {
      await markFilePermanentFailed(fileId, "File too large for Smartsheet mirror (over 30 MB)");
      return { ok: false, error: "size" };
    }
  }

  if (!blobRes.body) {
    await markFileRetryable(fileId, "Blob response had no body", row.sync_attempt_count);
    return { ok: false, error: "blob body" };
  }

  const nodeStream = webStreamToNodeReadableMaxBytes(
    blobRes.body,
    MAX_SMARTSHEET_MIRROR_FILE_BYTES
  );

  const attach = await attachFileToRowFromReadable(
    token,
    sheetId,
    rowId,
    row.original_filename,
    row.content_type || "application/pdf",
    nodeStream
  );

  if (!attach.ok) {
    if (isPermanentClientError(attach.httpStatus)) {
      await markFilePermanentFailed(fileId, attach.error, attach.httpStatus, attach.errorCode);
    } else if (isRetryableSmartsheetFailure(attach.httpStatus, attach.errorCode)) {
      await markFileRetryable(fileId, attach.error, row.sync_attempt_count, attach.httpStatus, attach.errorCode);
    } else {
      await markFileRetryable(fileId, attach.error, row.sync_attempt_count, attach.httpStatus, attach.errorCode);
    }
    return { ok: false, error: attach.error };
  }

  await markFileSyncedAfterUpload(fileId, attach.attachmentId, row.original_filename);
  return { ok: true };
}

export async function runAttachmentSyncBatch(): Promise<{
  processed: number;
  errors: number;
  staleReset: number;
}> {
  const staleReset = await resetStaleSyncingJobs();
  let processed = 0;
  let errors = 0;

  const { rows: pending } = await query<{ id: string }>(
    `SELECT isf.id
     FROM intake_submission_files isf
     WHERE isf.attachment_sync_status IN ('pending', 'retryable_failed')
       AND (isf.next_sync_attempt_at IS NULL OR isf.next_sync_attempt_at <= now())
       AND isf.smartsheet_row_id IS NOT NULL
     ORDER BY isf.created_at ASC
     LIMIT $1`,
    [SYNC_MAX_FILES_PER_RUN]
  );

  for (const p of pending) {
    const r = await processAttachmentFile(p.id);
    processed += 1;
    if (!r.ok) errors += 1;
  }

  return { processed, errors, staleReset };
}

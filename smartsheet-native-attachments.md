# Smartsheet Native Attachment Mirroring Spec

Status: Draft future-build spec  
Repo: `scholarship-review-platform`  
Last updated: 2026-03-22

This document scopes a future extension to the intake system where uploaded PDFs are mirrored into Smartsheet as native `FILE` attachments so Smartsheet becomes the final file system of record, not just the row-data source of truth.

This is intentionally separate from `forms.md` because the current shipped intake contract is still:

- row data writes directly to Smartsheet
- uploaded files live in private Vercel Blob
- reviewer/admin attachment APIs merge Smartsheet attachments plus intake-upload files

This document defines the future native-attachment build only.

---

## 1. Goal

After a public intake form submission creates a Smartsheet row, each uploaded PDF should be attached to that row as a native Smartsheet `FILE` attachment.

Target outcome:

- Smartsheet remains the canonical record for nominee row data
- Smartsheet also becomes the canonical long-term store for attached PDFs
- Blob is retained only as a secure staging layer during upload and mirroring

---

## 2. Non-Goals

This build does not:

- use Smartsheet `LINK` attachments
- replace the existing reviewer field-mapping builder
- move public file upload bytes through the public submit route
- support arbitrary file types beyond PDF
- preserve the current 100 MB upload cap when native Smartsheet mirroring is enabled

---

## 3. External Constraints

These constraints drive the architecture.

### 3.1 Smartsheet attachment limits

Per the official Smartsheet attachments API:

- native file attachments are uploaded with `multipart/form-data`
- file size limit is `30 MB`
- file attachment posting is rate-limited to `30 requests/minute per API token`

Reference:

- https://developers.smartsheet.com/api/smartsheet/openapi/attachments

### 3.2 Vercel runtime limits

Per current Vercel Node.js function limits:

- Node runtime is required
- duration and memory are finite even on Pro/Enterprise
- long-running file proxy work should not block the public submission route

Reference:

- https://vercel.com/docs/functions/limitations

### 3.3 Architectural consequence

Because Smartsheet native attachments cap at `30 MB`, a future “Smartsheet is the file source of truth” mode cannot keep the current v1 `100 MB` file limit unchanged.

Final decision for this future feature:

- if native Smartsheet attachment mirroring is enabled, mirrored file uploads must be capped at `30 MB`
- do not promise native Smartsheet storage for files larger than `30 MB`

---

## 4. Final Design Decisions

### 4.1 Blob remains the staging layer

Browser uploads still go directly to private Vercel Blob first.

Reason:

- avoids serverless body limits
- preserves the current public upload UX
- gives the app a durable object to retry from if Smartsheet attachment sync fails

### 4.2 Smartsheet `FILE` attachments only

This feature uses native Smartsheet file attachments, not `LINK` attachments.

Reason:

- `FILE` attachments are the only mode that makes Smartsheet the true binary record
- `LINK` attachments still leave Blob as the real storage layer

### 4.3 Attachment mirroring is asynchronous

The public `POST /api/submit/[cycleId]` route must not upload files to Smartsheet inline.

Instead:

1. public submit creates the row and persists staged file metadata
2. file records enter a pending sync state
3. a background worker or cron job mirrors staged PDFs into Smartsheet

### 4.4 Submit success is row-first, attachment-sync-second

The submission is considered successful once:

- the Smartsheet row exists
- intake submission/file metadata is persisted

Attachment mirroring is a second phase with its own status model.

### 4.5 Reviewer/admin APIs stay merged during transition

Attachment APIs should continue to return a merged list, but with stricter precedence:

- if a file has already synced to Smartsheet, return the Smartsheet attachment entry as the primary copy
- if a file is still pending or retrying, return a temporary staged-Blob attachment entry
- if sync has permanently failed, admin preview should show the staged file plus sync status/error; reviewer UI should not show failed internal-only states

### 4.6 Blob is deleted only after safe sync completion

Do not delete the staged Blob immediately after a successful Smartsheet attach.

Final decision:

- retain staged Blob files for `24 hours` after successful Smartsheet sync
- the cleanup job may then delete them if `smartsheet_attachment_id` is present and sync status is `synced`

This gives one short repair window while still making Smartsheet the long-term source of truth.

---

## 5. Data Model Changes

This feature should extend existing intake tables instead of introducing a second parallel file table.

### 5.1 Migration

Create a future migration:

- `006_smartsheet_attachment_sync.sql`

### 5.2 `intake_forms`

Add:

- `file_storage_mode VARCHAR(30) NOT NULL DEFAULT 'blob_only'`

Allowed values:

- `blob_only`
- `smartsheet_native`

Meaning:

- `blob_only`: current v1 behavior
- `smartsheet_native`: staged in Blob, then mirrored into Smartsheet `FILE` attachments

### 5.3 `intake_submission_files`

Add:

- `attachment_sync_status VARCHAR(30) NOT NULL DEFAULT 'pending'`
- `smartsheet_attachment_id BIGINT`
- `smartsheet_attachment_name VARCHAR(255)`
- `sync_attempt_count INT NOT NULL DEFAULT 0`
- `last_sync_attempt_at TIMESTAMPTZ`
- `synced_at TIMESTAMPTZ`
- `next_sync_attempt_at TIMESTAMPTZ`
- `sync_error_json JSONB`
- `blob_delete_after TIMESTAMPTZ`
- `blob_deleted_at TIMESTAMPTZ`

Allowed `attachment_sync_status` values:

- `pending`
- `syncing`
- `synced`
- `retryable_failed`
- `permanent_failed`
- `deleted_from_blob`

### 5.4 `intake_submissions`

Add an aggregate file-sync status for admin visibility:

- `attachment_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'`

Allowed values:

- `not_applicable`
- `pending`
- `partial`
- `synced`
- `failed`

This is derived from the related `intake_submission_files` rows and updated by the worker.

---

## 6. File Size and Upload Rules

### 6.1 Native-attachment mode changes the cap

When `file_storage_mode = 'smartsheet_native'`:

- upload max size becomes `30 MB`
- upload-token route must enforce `30 MB`
- public UI must display `30 MB` instead of `100 MB`

### 6.2 PDF only remains

Even in native-attachment mode:

- PDF only
- no image uploads
- no Word docs

### 6.3 Multi-file support still applies

If a file field allows multiple PDFs:

- each file becomes its own `intake_submission_files` row
- each file syncs independently
- per-file success/failure must not block unrelated files from syncing

---

## 7. Processing Flow

## 7.1 Happy path

1. Browser uploads PDFs to private Blob using scoped upload tokens.
2. Public submit route validates metadata and creates the Smartsheet row.
3. `intake_submission_files` records are inserted with `attachment_sync_status = 'pending'`.
4. `intake_submissions.attachment_sync_status` becomes `pending`.
5. Background worker selects pending files whose row already exists.
6. Worker downloads or streams the staged Blob object.
7. Worker uploads the file to Smartsheet `POST /sheets/{sheetId}/rows/{rowId}/attachments` as a `FILE` attachment.
8. Worker stores `smartsheet_attachment_id`, marks the file `synced`, and sets `blob_delete_after`.
9. When all files for the submission are synced, the parent submission aggregate becomes `synced`.
10. Cleanup job deletes the staged Blob after the retention window.

### 7.2 Do not block public submit on Smartsheet attachment sync

The public route must return after row creation and DB persistence.

Do not:

- proxy file bytes into Smartsheet from the public request
- make submit latency depend on attachment count
- risk submission timeouts because of Smartsheet attachment rate limits

---

## 8. Worker Design

### 8.1 Worker entrypoint

Add a protected Node route:

- `GET /api/admin/jobs/sync-smartsheet-attachments`

Protection:

- `CRON_SECRET`

Invocation:

- Vercel cron every `1 minute`
- optional admin manual retry action may invoke the same internal sync path

### 8.2 Batch size

Process a small bounded batch each run, for example:

- max `5` files per run per Smartsheet connection

Reason:

- Smartsheet attach-file writes are capped at `30 requests/minute/token`
- the app may have multiple cycles sharing one connection/token

### 8.3 Locking model

Before syncing a file:

- update `attachment_sync_status` from `pending` or `retryable_failed` to `syncing`
- set `last_sync_attempt_at = now()`
- increment `sync_attempt_count`

Only one worker may own a file row at a time.

### 8.4 Retry policy

Retryable failures:

- Smartsheet `429`
- Smartsheet transient `5xx`
- network timeouts fetching Blob
- network timeouts posting multipart request to Smartsheet

Permanent failures:

- staged Blob missing
- file exceeds Smartsheet size limit
- row ID missing
- sheet/connection credentials missing
- non-retryable Smartsheet `4xx`

Backoff:

- attempt 1: immediate or next cron
- attempt 2: +5 minutes
- attempt 3: +30 minutes
- attempt 4: +2 hours
- after max attempts: `permanent_failed`

---

## 9. Smartsheet API Layer

### 9.1 New helper

Add a new helper in `src/lib/smartsheet.ts`:

- `attachFileToRow(...)`

Behavior:

- accepts token, sheet ID, row ID, filename, content type, and a stream/blob source
- uses `multipart/form-data`
- returns structured `httpStatus`, `errorCode`, and `attachmentId`

### 9.2 Attachment listing remains

Existing `getRowAttachments(...)` remains the read path for synced files.

### 9.3 Duplicate prevention

Do not rely only on filename uniqueness.

Primary duplicate prevention:

- one `intake_submission_files` row per staged Blob pathname
- if `smartsheet_attachment_id` already exists for that file row, never attach again

Optional safety:

- if the worker restarts after successful Smartsheet attach but before DB update, admin repair may require checking current row attachments by filename and size before retrying

---

## 10. Attachment API Behavior

### 10.1 Reviewer API

`/api/reviewer/cycles/[cycleId]/rows/[rowId]/attachments`

Return:

- Smartsheet attachments
- staged Blob fallback entries only for file rows whose sync status is `pending`, `syncing`, or `retryable_failed`

Do not return duplicate staged entries once a synced Smartsheet attachment is known for that file row.

### 10.2 Admin preview API

`/api/admin/cycles/[id]/preview-rows/[rowId]/attachments`

Return:

- Smartsheet attachments
- staged Blob fallback entries for pending/retrying files
- failed file entries with sync status metadata so admins can repair the issue

### 10.3 Normalized payload

Extend the attachment payload shape to support state:

- `id`
- `name`
- `url`
- `source`
- `syncStatus`
- `isFallback`

Possible `source` values:

- `smartsheet`
- `intake_upload_pending`
- `intake_upload_failed`

---

## 11. Admin UX Changes

### 11.1 Intake builder

When `file_storage_mode = 'smartsheet_native'`:

- show a clear note that files are mirrored into Smartsheet native attachments
- show `30 MB` max file size
- warn that larger files are not supported in this mode

### 11.2 Submission audit table

Admin submissions UI must show:

- row creation status
- aggregate attachment sync status
- count of pending/synced/failed files

### 11.3 Admin recovery actions

Add:

- `Retry attachment sync`
- `Mark attachment failure resolved`
- `View staged file`

Rules:

- retry must never create a second Smartsheet row
- retry only re-processes file rows whose sync is not already `synced`

---

## 12. Failure Handling

### 12.1 Row exists but attachment sync is pending

Submission remains valid.

Behavior:

- reviewer/admin may still see staged Blob fallback
- aggregate status stays `pending` until files finish syncing

### 12.2 Row exists but one attachment permanently fails

Behavior:

- keep submission row
- mark the file `permanent_failed`
- set parent aggregate to `partial` or `failed`
- expose admin retry/repair controls

### 12.3 Oversize file in native mode

Behavior:

- reject upload-token request before upload
- return a clear `400`
- do not allow a `>30 MB` file into a native-attachment flow

### 12.4 Staged Blob missing during sync

Behavior:

- mark file `permanent_failed`
- require admin intervention

---

## 13. Cleanup Rules

### 13.1 Pending orphan cleanup

Continue deleting staged files that never reached a completed submission after `24 hours`.

### 13.2 Synced cleanup

If:

- `attachment_sync_status = 'synced'`
- `smartsheet_attachment_id IS NOT NULL`
- `blob_delete_after <= now()`
- `blob_deleted_at IS NULL`

then the cleanup job may delete the staged Blob and mark `blob_deleted_at`.

### 13.3 Failed files

Do not auto-delete permanently failed staged files immediately.

Final decision:

- retain failed staged files for `7 days`
- then allow cleanup if still unresolved

---

## 14. Recommended Build Order

1. Add migration `006_smartsheet_attachment_sync.sql`
2. Add `file_storage_mode` form setting and `30 MB` validation when native mode is enabled
3. Add `attachFileToRow(...)` helper in `src/lib/smartsheet.ts`
4. Add sync-status fields and aggregate update logic in `src/lib/intake.ts`
5. Add cron worker route for attachment sync
6. Update reviewer/admin attachment APIs to prefer synced Smartsheet attachments
7. Update admin submissions UI with attachment-sync visibility and retry actions
8. Update cleanup job to purge successfully mirrored staged Blobs after retention

---

## 15. Recommendation

This should be built as a separate post-v1 project, not folded into the current intake batch.

Reason:

- it changes the effective upload limit from `100 MB` to `30 MB`
- it adds a second async state machine after row creation
- it introduces Smartsheet attachment rate-limit pressure
- it requires admin repair tooling before it is safe in production

Recommended release label:

- `v1.5` if the scope is limited to PDF mirroring and admin recovery
- `v2` if the team wants stronger queueing, richer status dashboards, and stricter Smartsheet-only attachment semantics

---

## 16. References

- Smartsheet attachments API: https://developers.smartsheet.com/api/smartsheet/openapi/attachments
- Vercel function limits: https://vercel.com/docs/functions/limitations

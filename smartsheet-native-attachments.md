# Smartsheet Native Attachment Mirroring Spec

Status: Implementation-ready spec — post-v1 build
Repo: `scholarship-review-platform`
Last updated: 2026-03-22

---

## Purpose

This platform is designed to support any workflow that uses Smartsheet as a source of truth for structured row data — not just graduate scholarship review. Different programs, departments, and use cases will configure intake forms for different purposes: nomination packets, grant submissions, project requests, compliance filings, and more.

Attachment behavior varies significantly across those contexts. Some programs submit large required PDFs that must be permanently archived alongside the nominee record. Other workflows attach lightweight supporting documents where Smartsheet visibility is more useful than long-term Blob storage.

The platform already addresses long-term file archiving through the existing zip export feature, which allows admins to pull all attached files for a cycle into a single archive. That mechanism is the primary defense against API outages and attachment loss for high-risk programs. It is intentionally decoupled from this feature.

This spec adds a complementary option for programs where Smartsheet is the natural file record: a per-field toggle in the intake builder that, when enabled, causes that field's uploaded files to be mirrored into Smartsheet as native `FILE` attachments after submission. This is an opt-in feature at the field level, not a platform-wide requirement. Programs that do not check the box continue to work exactly as they do today. Programs that do check it get Smartsheet as their file record for that field.

The design is intentionally lightweight:

- Blob remains the upload layer for all programs, regardless of this setting
- Sync is asynchronous so submission reliability is not coupled to Smartsheet API availability
- Each attachment field opts in independently, so a form can mix native-sync fields and blob-only fields
- The 30 MB Smartsheet limit applies only to fields with sync enabled; blob-only fields retain the 100 MB cap

This document defines the future native-attachment build only. The current shipped intake contract — files in Blob, reviewer/admin APIs merging Smartsheet and Blob attachments — remains unchanged for all forms that do not enable this feature.

---

## 1. Goal

When an admin enables "Push to Smartsheet" on an attachment field, uploaded PDFs from that field should be mirrored into Smartsheet as native `FILE` attachments on the submission's row.

Target outcome:

- Smartsheet becomes the canonical long-term store for files from enabled fields
- Blob is the staging layer only; it can be cleaned up after sync completes
- Programs that do not enable the option are unaffected
- Programs that do enable it get Smartsheet visibility without changing their submission flow

---

## 2. Non-Goals

This build does not:

- use Smartsheet `LINK` attachments
- replace the zip export feature or the long-term Blob archiving it provides
- move public file upload bytes through the public submit route
- support arbitrary file types beyond PDF
- apply a 30 MB cap to fields that do not have sync enabled
- add a form-level sync toggle; the toggle is per attachment field

---

## 3. External Constraints

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
- long-running file proxy work must not block the public submission route

Reference:

- https://vercel.com/docs/functions/limitations

### 3.3 Architectural consequence of the 30 MB cap

Smartsheet native attachments cap at `30 MB`. This is a hard constraint, not a configuration option.

Final decision:

- when `push_to_smartsheet = true` on a field, that field's upload cap becomes `30 MB`
- the upload-token route enforces this cap per field at token issuance time
- blob-only fields retain the `100 MB` cap

---

## 4. Final Design Decisions

### 4.1 Sync is per attachment field

The "Push to Smartsheet" setting lives on the attachment field definition, not on the intake form.

Reason:

- a single form may have one required-PDF field worth mirroring and one lightweight reference field that does not need it
- form-level toggles would force an all-or-nothing decision per program
- per-field control matches how the platform already handles other field behaviors (required flag, blind-review hiding, column mapping)

### 4.2 Blob remains the staging layer for all programs

Browser uploads still go directly to private Vercel Blob first, regardless of the push setting.

Reason:

- avoids serverless body limits
- preserves submission UX and reliability
- gives the worker a durable retry source if Smartsheet is temporarily unavailable

### 4.3 Smartsheet `FILE` attachments only

This feature uses native Smartsheet file attachments, not `LINK` attachments.

Reason:

- `FILE` attachments make Smartsheet the true binary record
- `LINK` attachments still leave Blob as the real storage layer

### 4.4 Attachment mirroring is asynchronous

The public `POST /api/submit/[cycleId]` route must not upload files to Smartsheet inline.

Instead:

1. public submit creates the row and persists staged file metadata
2. file records with `push_to_smartsheet = true` enter a pending sync state
3. a background cron worker mirrors them into Smartsheet

### 4.5 Submit success is row-first, attachment-sync-second

The submission is considered successful once:

- the Smartsheet row exists
- intake submission/file metadata is persisted

Attachment mirroring is a second phase with its own status model. A sync failure does not invalidate the submission.

### 4.6 Reviewer/admin APIs stay merged

Attachment APIs continue to return a merged list with strict precedence:

- if a file has already synced to Smartsheet, return the Smartsheet attachment entry as the primary copy
- if a file is still pending or retrying, return a staged-Blob fallback entry with a fresh signed URL
- if sync has permanently failed, admin preview shows the staged file plus sync status; reviewer UI does not surface internal sync state

### 4.7 Blob is deleted only after confirmed sync

Final decision:

- retain staged Blob files for `24 hours` after a successful Smartsheet sync
- the cleanup job may delete them only when `smartsheet_attachment_id` is set and sync status is `synced`

Blob-only files (where `push_to_smartsheet = false`) follow the existing orphan and retention cleanup rules and are not touched by this feature's cleanup logic.

---

## 5. Data Model Changes

This feature extends existing intake tables.

### 5.1 Migration

Create migration at the next available sequential number at build time.

Working placeholder: `006_smartsheet_attachment_sync.sql`

Assign the actual number based on whatever migrations ship between now and when this feature builds.

### 5.2 `field_configs`

Add:

- `push_to_smartsheet BOOLEAN NOT NULL DEFAULT FALSE`

This flag is only meaningful on file-type fields. It is safe to add to all `field_configs` rows with a default of `false`.

Effect:

- `false` (default): file is uploaded to Blob and stays there; current v1 behavior
- `true`: file is uploaded to Blob and then mirrored into Smartsheet as a native `FILE` attachment; upload cap is `30 MB`

### 5.3 `intake_submission_files`

Add sync tracking columns:

- `attachment_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'`
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

- `not_applicable`: field has `push_to_smartsheet = false`; sync will never run for this file
- `pending`: queued, not yet picked up by a worker
- `syncing`: claimed by the current worker run
- `synced`: successfully attached to Smartsheet
- `retryable_failed`: last attempt failed with a transient error; will be retried
- `permanent_failed`: max attempts exhausted or non-retryable error; requires admin action
- `deleted_from_blob`: staged Blob cleaned up after successful sync

At submission time: if `push_to_smartsheet = false` on the field, insert with `attachment_sync_status = 'not_applicable'`. If `push_to_smartsheet = true`, insert with `attachment_sync_status = 'pending'`.

### 5.4 `intake_submissions`

Add an aggregate sync status for admin visibility:

- `attachment_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'`

Allowed values:

- `not_applicable`: the submission has no push-enabled file fields
- `pending`: at least one push-enabled file is not yet synced
- `partial`: some push-enabled files are synced, at least one is pending or failed
- `synced`: all push-enabled files have successfully mirrored
- `failed`: at least one push-enabled file reached `permanent_failed`

This aggregate counts only files where the source field has `push_to_smartsheet = true`. Blob-only files do not affect it.

The worker updates this aggregate after each sync attempt.

---

## 6. File Size and Upload Rules

### 6.1 Per-field cap enforcement

The upload-token route must check `push_to_smartsheet` on the field before issuing a token.

- field has `push_to_smartsheet = false`: enforce `100 MB` cap
- field has `push_to_smartsheet = true`: enforce `30 MB` cap

The public form UI must display the correct cap per field based on the field's push setting.

### 6.2 PDF only remains

For all file fields, regardless of push setting:

- PDF only
- no image uploads
- no Word docs

### 6.3 Multi-file support still applies

If a push-enabled file field allows multiple PDFs:

- each file becomes its own `intake_submission_files` row
- each file syncs independently
- per-file success or failure does not block unrelated files from syncing

---

## 7. Processing Flow

### 7.1 Happy path

1. Browser uploads PDFs to private Blob using scoped upload tokens (cap determined by field push setting).
2. Public submit route validates metadata and creates the Smartsheet row.
3. `intake_submission_files` records are inserted. Push-enabled files get `attachment_sync_status = 'pending'`; blob-only files get `not_applicable`.
4. If any push-enabled files exist, `intake_submissions.attachment_sync_status` becomes `pending`.
5. Background worker selects eligible pending files (see Section 8.2).
6. Worker claims each file atomically (see Section 8.3).
7. Worker checks whether the file is already attached to the Smartsheet row (see Section 9.3).
8. Worker downloads or streams the staged Blob object.
9. Worker uploads the file to Smartsheet `POST /sheets/{sheetId}/rows/{rowId}/attachments` as a `FILE` attachment.
10. Worker writes `smartsheet_attachment_id`, marks the file `synced`, and sets `blob_delete_after = now() + 24 hours`.
11. Worker updates the parent `intake_submissions.attachment_sync_status` aggregate.
12. Cleanup job deletes the staged Blob after the retention window.

### 7.2 Do not block public submit on Smartsheet attachment sync

The public route must return after row creation and DB persistence.

Do not:

- proxy file bytes into Smartsheet from the public request
- make submit latency depend on attachment count or push settings
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

### 8.2 File selection query

Each worker run selects eligible files using this predicate:

- `attachment_sync_status IN ('pending', 'retryable_failed')`
- `next_sync_attempt_at IS NULL OR next_sync_attempt_at <= now()`
- grouped by Smartsheet connection token
- limited to `5` files per connection per run

The `next_sync_attempt_at` filter is mandatory. Without it, the worker ignores the backoff schedule and hammers Smartsheet on every cron tick.

Reason for the per-connection batch cap:

- Smartsheet attach-file writes are capped at `30 requests/minute/token`
- multiple cycles may share one connection/token across different programs

### 8.3 Atomic locking

The worker must claim a file atomically before processing it.

Required implementation:

- use a single `UPDATE intake_submission_files SET attachment_sync_status = 'syncing', last_sync_attempt_at = now(), sync_attempt_count = sync_attempt_count + 1 WHERE id = $id AND attachment_sync_status IN ('pending', 'retryable_failed') RETURNING *`
- if the update returns zero rows, another worker has already claimed this file; skip it

Do not implement this as a read followed by a separate update. A read-then-update creates a race window where concurrent worker invocations both claim and process the same file, resulting in duplicate Smartsheet attachments.

#### Stale `syncing` recovery

If a worker crashes or times out after setting status to `syncing` but before completing, the file row stays in `syncing` indefinitely and is never retried.

Recovery rule:

- at the start of each worker run, before selecting new files, update any rows where `attachment_sync_status = 'syncing' AND last_sync_attempt_at < now() - interval '10 minutes'` back to `retryable_failed`

This ensures stale claims are released and the file re-enters the retry queue on the next run.

### 8.4 Retry policy

**Retryable failures:**

- Smartsheet `429`
- Smartsheet transient `5xx`
- network timeout fetching Blob
- network timeout posting multipart request to Smartsheet

**Permanent failures:**

- staged Blob missing or expired
- file exceeds Smartsheet `30 MB` size limit
- Smartsheet row ID missing
- sheet or connection credentials missing or revoked
- non-retryable Smartsheet `4xx` (excluding `429`)

**Backoff schedule:**

- attempt 1: immediate (next cron run)
- attempt 2: `next_sync_attempt_at = now() + 5 minutes`
- attempt 3: `next_sync_attempt_at = now() + 30 minutes`
- attempt 4: `next_sync_attempt_at = now() + 2 hours`

**Maximum attempts:** 4

After the fourth attempt fails with a retryable error, set `attachment_sync_status = 'permanent_failed'`. Do not continue retrying.

On any permanent failure, set `attachment_sync_status = 'permanent_failed'` immediately regardless of attempt count.

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

### 9.3 Duplicate attachment prevention

Do not rely only on filename uniqueness.

**Primary prevention (required):**

- one `intake_submission_files` row per staged Blob pathname
- if `smartsheet_attachment_id` already exists for that file row, skip the Smartsheet attach call entirely and treat the file as already synced

**Crash-recovery guard (required):**

A worker may successfully post a file to Smartsheet but crash before writing `smartsheet_attachment_id` back to the DB. On the next retry, the DB row shows no `smartsheet_attachment_id`, so the primary check does not fire.

Before posting to Smartsheet on any retry attempt (i.e., `sync_attempt_count > 1`), the worker must call `getRowAttachments(...)` and check whether an attachment with a matching filename and file size already exists on the row. If a match is found, write the existing `attachmentId` to `smartsheet_attachment_id`, mark the file `synced`, and skip the upload.

This guard is required, not optional. Without it, a crash between Smartsheet success and DB update results in a permanent duplicate attachment on the Smartsheet row.

---

## 10. Attachment API Behavior

### 10.1 Signed URL rule for Blob fallback entries

When returning a staged Blob fallback entry for a file that has not yet synced, the API must generate a fresh signed URL at read time.

Do not store and return a static Blob URL. Static URLs expire. A file in `retryable_failed` with a 2-hour backoff will still be referenced in admin and reviewer UIs during that window, and an expired URL produces a broken link.

### 10.2 Reviewer API

`/api/reviewer/cycles/[cycleId]/rows/[rowId]/attachments`

Return:

- Smartsheet `FILE` attachments
- staged Blob fallback entries (with fresh signed URLs) for file rows whose sync status is `pending`, `syncing`, or `retryable_failed`

Do not return duplicate staged entries once a synced Smartsheet attachment is confirmed for that file row.

Blob-only files (`not_applicable`) are returned as ordinary attachments with no sync metadata exposed.

### 10.3 Admin preview API

`/api/admin/cycles/[id]/preview-rows/[rowId]/attachments`

Return:

- Smartsheet `FILE` attachments
- staged Blob fallback entries (with fresh signed URLs) for pending and retrying files
- failed file entries with sync status metadata so admins can see and repair the issue

### 10.4 Normalized payload shape

Extend the attachment payload shape:

- `id`
- `name`
- `url`
- `source`
- `syncStatus`
- `isFallback`

Possible `source` values:

- `smartsheet`: attachment confirmed in Smartsheet
- `intake_upload_pending`: file is queued or in-flight; Blob URL is a temporary fallback
- `intake_upload_failed`: file reached `permanent_failed`; Blob URL is the only remaining copy
- `intake_upload_blob_only`: file is from a non-sync field; Blob is the permanent store

`pending` and `syncing` both map to `intake_upload_pending`. The internal distinction is not exposed to reviewer or admin UIs.

---

## 11. Admin UX Changes

### 11.1 Intake builder — field-level toggle

When an admin adds or edits an attachment field in the intake builder, the field properties panel must include:

- a checkbox labeled `Push uploaded files to Smartsheet as native attachments`
- when checked, a note reading: `Files from this field will be mirrored to Smartsheet after submission. Maximum file size is 30 MB.`
- when checked, the displayed file size limit updates from `100 MB` to `30 MB`
- when unchecked, the field behaves as today; files stay in Blob

This setting maps to `field_configs.push_to_smartsheet`.

The checkbox should not appear on non-file field types.

### 11.2 Submission audit table

Admin submissions UI must show when any push-enabled files are present:

- row creation status
- aggregate attachment sync status
- count of pending / synced / failed files (push-enabled only)

Blob-only file counts are shown separately and do not affect the sync aggregate.

### 11.3 Admin recovery actions

Add:

- `Retry attachment sync`
- `Mark attachment failure resolved`
- `View staged file`

Rules:

- retry must never create a second Smartsheet row
- retry resets `attachment_sync_status` to `pending` and clears `next_sync_attempt_at` only for file rows where `smartsheet_attachment_id IS NULL` and status is `retryable_failed` or `permanent_failed`
- retry must not re-process a file that is already `synced`

---

## 12. Failure Handling

### 12.1 Row exists, attachment sync is pending

Submission remains valid.

Behavior:

- reviewer and admin may see staged Blob fallback entries
- aggregate status stays `pending` until all push-enabled files complete

### 12.2 Row exists, one attachment permanently failed

Behavior:

- keep the submission row
- mark the file `permanent_failed`
- update parent aggregate to `partial` (if other push-enabled files synced) or `failed` (if none synced)
- expose admin retry and repair controls

### 12.3 Oversize file on a push-enabled field

Behavior:

- reject upload-token request before the browser upload begins
- return a clear `400`
- do not allow a file larger than `30 MB` into the sync pipeline

### 12.4 Staged Blob missing during sync

Behavior:

- mark file `permanent_failed` immediately regardless of attempt count
- write the error to `sync_error_json`
- require admin intervention
- do not retry; the source object is gone

---

## 13. Cleanup Rules

### 13.1 Pending orphan cleanup

Continue deleting staged files that never reached a completed submission after `24 hours`.

This applies to pre-submission orphans only. It must not touch file rows that belong to a completed `intake_submissions` record, regardless of sync status.

### 13.2 Synced file cleanup

The cleanup job may delete the staged Blob and set `blob_deleted_at` only when all four conditions are true:

- `attachment_sync_status = 'synced'`
- `smartsheet_attachment_id IS NOT NULL`
- `blob_delete_after <= now()`
- `blob_deleted_at IS NULL`

The `smartsheet_attachment_id IS NOT NULL` check is mandatory. Omitting it risks deleting a staged Blob for a file that appears synced by status but has no confirmed Smartsheet record.

Files with `attachment_sync_status = 'not_applicable'` are never touched by sync cleanup.

### 13.3 Failed file cleanup

Do not auto-delete permanently failed staged files immediately.

Final decision:

- retain `permanent_failed` staged files for `7 days` after `last_sync_attempt_at`
- after 7 days, allow cleanup if status is still `permanent_failed` and `blob_deleted_at IS NULL`

---

## 14. Recommended Build Order

1. Add migration (assign the correct sequential number at build time)
2. Add `push_to_smartsheet` column to `field_configs` with `DEFAULT FALSE`
3. Add the push toggle checkbox to the attachment field properties panel in the intake builder; enforce `30 MB` cap on upload-token issuance when enabled
4. Add `attachFileToRow(...)` helper in `src/lib/smartsheet.ts`
5. Add sync-status fields and aggregate update logic in `src/lib/intake.ts`
6. Add cron worker route with atomic claiming, stale-syncing recovery, backoff, and duplicate guard; query only files from push-enabled fields
7. Update reviewer and admin attachment APIs to prefer synced Smartsheet entries, return fresh signed URLs for fallbacks, and surface `not_applicable` files correctly
8. Update admin submissions UI with sync visibility and retry actions scoped to push-enabled files
9. Update cleanup job to handle synced Blob deletion and failed file retention, skipping `not_applicable` rows

---

## 15. Recommendation

This should be built as a separate post-v1 project, not folded into the current intake batch.

Reason:

- the per-field toggle requires intake builder changes and a new field property
- the async sync state machine adds complexity after row creation
- Smartsheet attachment rate-limit pressure requires careful batching
- admin repair tooling must exist before this is safe in production

The zip export feature is the primary long-term archiving path and remains independent of this feature. Programs that need a guaranteed complete archive of all files should use zip export regardless of whether they enable Smartsheet native sync.

Recommended release label:

- `v1.5` if the scope is limited to the per-field toggle, PDF mirroring, and admin recovery
- `v2` if the team wants stronger queueing, richer status dashboards, and stricter Smartsheet-only semantics

---

## 16. References

- Smartsheet attachments API: https://developers.smartsheet.com/api/smartsheet/openapi/attachments
- Vercel function limits: https://vercel.com/docs/functions/limitations

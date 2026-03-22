# Intake Form Tool Build Specification

Final build specification for the intake-form feature in `scholarship-review-platform`.

This document is intended to be build-ready. It makes final decisions for v1 so the implementation can proceed without unresolved product or architecture blockers.

For broader platform context, see `PROJECT_SPEC.md`.

---

## 1. Objective

Replace Gravity Forms / WordPress as the nomination intake mechanism for graduate scholarship programs.

Staff coordinators submit one nomination form per student. Each successful submission creates a new row in the cycle's Smartsheet. The existing reviewer workflow continues to use the Smartsheet row as the canonical nominee record.

Smartsheet remains the source of truth for structured nominee data. Postgres stores intake configuration, publication/version state, submission lifecycle metadata, file metadata, and abuse-control records.

---

## 2. Final Decisions For V1

These decisions are locked for the initial build.

| Area | Final decision |
|---|---|
| Build command | `npm run build`, which currently runs `next build` |
| Bundler | Default Next.js 16 production bundler for this repo, which is Turbopack |
| Runtime for intake routes | Explicit `export const runtime = "nodejs"` on all intake admin/public routes |
| Auth model | Public unauthenticated form with abuse controls, not identity-proof authentication |
| Staff restriction | Required `@wsu.edu` email suffix validation in v1 |
| SSO / email verification | Not part of v1 |
| Published form model | Immutable published snapshot only; drafts are never served publicly |
| Schema drift policy | Block submit and auto-unpublish the intake form if live schema validation fails |
| Duplicate submissions | Allowed; no automatic duplicate blocking in v1 |
| Edit after submit | Not supported; admin deletes the row and the coordinator resubmits |
| Field types exposed in builder | `short_text`, `long_text`, `email`, `number`, `select`, `checkbox`, `date`, `file` |
| Smartsheet column types allowed for v1 intake mapping | `TEXT_NUMBER`, `PICKLIST`, `DATE`, `CHECKBOX` |
| CONTACT_LIST / MULTI_CONTACT_LIST mapping | Out of scope for v1; builder must not allow mapping public intake fields to those column types |
| File storage | Private Vercel Blob |
| File access in reviewer/admin UI | App-generated signed Blob URLs via attachment APIs |
| Smartsheet LINK attachments | Not used in v1 |
| Reviewer attachment integration | Reviewer/admin attachment APIs will merge Smartsheet attachments plus intake-upload files keyed by `row_id` |
| Large-file handling | Direct browser upload only; the submit route is metadata-only |
| Idempotency | Required; every submission uses a stable `submission_id` |
| Rate limiting | DB-backed, IP-hash based |
| PII retention | Minimal operational storage only; no full payloads in audit logs |

These decisions supersede earlier working drafts.

---

## 3. Build Contract For This Repo

- Vercel runs `npm run build`.
- `package.json` currently defines `npm run build` as `next build`.
- On Next.js 16, plain `next build` uses Turbopack by default. That is the current build contract for this repo.
- `--webpack` is not part of the build spec here and must not be added unless a reproduced production-build regression justifies it.
- All new intake routes must explicitly export `runtime = "nodejs"` even though App Router route handlers default to Node.js. The explicit export is a guardrail because these routes will use Postgres, crypto, and upload-token logic.

Local verification before pushing:

- `npm run build`
- `npx tsc --noEmit`
- `npm test` for any route, auth, Smartsheet-write, or file-attachment change

---

## 4. Scope

### 4.1 In scope for v1

- Intake-form admin builder
- Draft and published intake-form versions
- Public read-only schema route
- Public metadata-only submit route
- Private Blob uploads via short-lived upload tokens
- Smartsheet row creation for structured form fields
- DB tracking of submission lifecycle
- Reviewer/admin viewing of intake-upload files alongside Smartsheet attachments
- Public abuse controls and audit logging

### 4.2 Out of scope for v1

- SSO
- mailbox verification
- editing a submission after success
- automatic duplicate blocking
- public mapping to CONTACT_LIST or MULTI_CONTACT_LIST columns
- Smartsheet LINK attachment mirroring
- rich-text instructions editor

Out-of-scope items must not be partially implemented.

---

## 5. Architecture

### 5.1 Source of truth

- Smartsheet is the source of truth for nominee row fields.
- Postgres is the source of truth for intake-form configuration, publication/version state, submission status, file metadata, and rate-limit data.
- Blob is the binary object store for uploaded files.

### 5.2 Public serving model

- Public routes never read draft intake-form rows directly.
- Public routes only serve the currently published intake-form version for the cycle.
- Admin edits affect only draft state until publish.

### 5.3 Live validation model

The public submit route must validate the live Smartsheet schema at submit time before creating a row.

Validation must confirm:

- every mapped target column still exists
- every mapped target column type still matches the published schema
- every mapped target column is supported by v1
- every mapped target column is writable
- every picklist value is valid under the chosen strictness rules

If live validation fails:

- the submission is rejected
- no row is created
- the form is auto-unpublished
- an audit entry is written
- admin UI shows the form as invalid until republished

---

## 6. Data Model

Migration 005 will add the following tables.

### 6.1 `intake_forms`

One row per cycle.

Required columns:

- `id`
- `cycle_id` unique
- `title`
- `instructions_text`
- `status` (`draft`, `published`, `unpublished`, `invalid`)
- `opens_at`
- `closes_at`
- `published_version_id`
- `created_at`
- `updated_at`

Rules:

- `instructions_text` is plain text in v1
- there is at most one active intake-form container per cycle

### 6.2 `intake_form_fields`

Draft builder rows only.

Required columns:

- `id`
- `intake_form_id`
- `field_key`
- `label`
- `help_text`
- `field_type`
- `required`
- `sort_order`
- `target_column_id`
- `target_column_title`
- `target_column_type`
- `settings_json`
- `created_at`
- `updated_at`

Rules:

- `field_key` is unique within the intake form
- `field_type` must be one of the v1-allowed field types
- `target_column_type` must be one of the v1-allowed Smartsheet column types

### 6.3 `intake_form_versions`

Immutable published and superseded snapshots.

Required columns:

- `id`
- `intake_form_id`
- `version_number`
- `status` (`draft`, `published`, `superseded`)
- `snapshot_json`
- `created_by_user_id`
- `created_at`
- `published_at`

Rules:

- `snapshot_json` contains the complete public form contract
- public routes read from `snapshot_json`, not from draft rows

### 6.4 `intake_submissions`

Tracks the lifecycle of one public submission.

Required columns:

- `id`
- `submission_id` unique
- `cycle_id`
- `intake_form_id`
- `intake_form_version_id`
- `submitter_email`
- `status`
- `smartsheet_row_id`
- `request_cells_json`
- `request_files_json`
- `failure_json`
- `ip_hash`
- `created_at`
- `updated_at`
- `completed_at`

Allowed statuses:

- `pending`
- `processing`
- `row_created`
- `completed`
- `failed`
- `rate_limited`
- `invalid_schema`

Rules:

- `request_cells_json` and `request_files_json` exist for idempotent recovery and replay
- these request snapshots are operational metadata, not canonical source-of-truth data
- retention policy:
  - completed request snapshots kept 30 days, then nulled
  - failed request snapshots kept 90 days

### 6.5 `intake_submission_files`

Stores file metadata keyed to the submission and Smartsheet row.

Required columns:

- `id`
- `submission_id` FK to `intake_submissions.submission_id`
- `cycle_id`
- `field_key`
- `blob_url`
- `blob_pathname`
- `original_filename`
- `content_type`
- `size_bytes`
- `smartsheet_row_id`
- `created_at`

Rules:

- files are stored only after the submission reaches at least `row_created`
- reviewer/admin attachment APIs read from this table by `cycle_id` and `smartsheet_row_id`

### 6.6 `intake_rate_limit_events`

DB-backed rate limiting for public routes.

Required columns:

- `id`
- `cycle_id`
- `route_key`
- `ip_hash`
- `created_at`

Rules:

- `ip_hash` is HMAC-SHA256 of the client IP using `ENCRYPTION_KEY`
- raw IP addresses are never stored
- retention policy: 14 days

---

## 7. Admin Builder Specification

### 7.1 UI pattern

The builder must reuse existing admin patterns where practical:

- accordion-card layout
- drag-to-reorder interactions
- explicit target-column display including column type
- inline validation errors

### 7.2 Builder capabilities

Admins can:

- set title
- set plain-text instructions
- set open/close timestamps
- add, remove, and reorder fields
- map each field to a Smartsheet column
- publish
- unpublish

### 7.3 Builder validation rules

The builder must reject:

- unsupported field types
- unsupported target Smartsheet column types
- duplicate field keys
- duplicate target-column mappings when the same target column would receive conflicting values
- missing labels
- missing target columns
- file fields mapped to non-file metadata handling rules

### 7.4 File fields

In v1, a `file` field represents an app-managed Blob upload associated with the resulting Smartsheet row.

It does not map to a Smartsheet attachment column because Smartsheet does not have one. File fields therefore:

- store `field_key` in the published form snapshot
- store file metadata in `intake_submission_files`
- appear in reviewer/admin attachment lists after submission

---

## 8. Public API Specification

All intake routes must export `runtime = "nodejs"`.

### 8.1 `GET /api/submit/[cycleId]`

Purpose:

- return the currently published form definition and availability status

Response behavior:

- `404` if no intake form is published
- `200` with `status: "open" | "scheduled" | "closed"` if a published form exists

Response payload includes:

- `cycleId`
- `formVersionId`
- `title`
- `instructionsText`
- `opensAt`
- `closesAt`
- `status`
- ordered public `fields`
- public file limits

### 8.2 `POST /api/submit/[cycleId]/upload-token`

Purpose:

- authorize direct browser upload to private Blob

Request body:

- `submissionId`
- `fieldKey`
- `filename`
- `contentType`
- `sizeBytes`

Validation:

- form is published
- public status is `open`
- `submissionId` is present
- `fieldKey` exists in the published version and is a `file` field
- `contentType` is `application/pdf`
- `sizeBytes <= 104857600` (100 MB)

Rate limit:

- max 10 upload-token requests per IP per 15 minutes per cycle

Response:

- short-lived upload token
- canonical upload pathname prefix

### 8.3 `POST /api/submit/[cycleId]`

Purpose:

- validate the submission
- create the Smartsheet row
- persist submission/file metadata

Request body:

- `submissionId`
- `formVersionId`
- `submitterEmail`
- `fields`
- `files`

Rules:

- request is metadata-only
- raw file bytes are never accepted
- `submitterEmail` must end with `@wsu.edu`
- `formVersionId` must match the currently published version

Rate limit:

- max 5 submit attempts per IP per 15 minutes per cycle
- max 25 submit attempts per IP per 24 hours per cycle

Success response:

- `201`
- `submissionId`
- `rowId`
- confirmation message

Failure responses:

- `400` validation error
- `404` no published form
- `409` stale `formVersionId` or already-completed `submissionId`
- `429` rate limited
- `503` Smartsheet upstream failure or retryable processing failure

---

## 9. Public Form Validation Rules

### 9.1 Field-type rules

- `short_text`: non-empty string if required
- `long_text`: non-empty string if required
- `email`: valid email format and must end with `@wsu.edu`
- `number`: numeric input only
- `select`: value must be one of the published field options
- `checkbox`: boolean
- `date`: ISO date string
- `file`: must reference an uploaded Blob object tied to the same `submissionId`

### 9.2 General validation rules

- unknown fields are rejected
- fields omitted from the published version are rejected
- required fields must be present
- hidden/draft-only fields are never accepted from the client

---

## 10. Smartsheet Mapping Rules

### 10.1 Allowed target column types in v1

- `TEXT_NUMBER`
- `PICKLIST`
- `DATE`
- `CHECKBOX`

The builder must not allow mapping to:

- `CONTACT_LIST`
- `MULTI_CONTACT_LIST`
- system-managed columns
- auto-number columns
- formula columns
- unsupported symbol columns

### 10.2 Add-row helper

Implement a dedicated `addRow` helper in `src/lib/smartsheet.ts`.

The helper must:

- accept a typed cell array
- coerce `null` to `""`
- return structured errors including `httpStatus` and `errorCode`
- surface rate limiting as `429` / `4003`

### 10.3 Cell serialization rules

- never send `value: null`
- never send both `value` and `objectValue` on the same cell
- `TEXT_NUMBER`: send `value`
- `PICKLIST`: send `value`; use `strict: true`
- `DATE`: send ISO date string in the format Smartsheet accepts
- `CHECKBOX`: send boolean `value`

### 10.4 Picklists

V1 does not support free-form overrides for published select fields.

Therefore:

- all select options are defined in the builder
- all select options must match the target Smartsheet picklist options at publish time
- publish is blocked if the option sets are incompatible
- row creation uses `strict: true`

This avoids off-list picklist writes in v1.

---

## 11. File Upload And Attachment Model

### 11.1 Storage model

- files upload directly from browser to private Vercel Blob
- the submit route never proxies file bytes
- file metadata is persisted in `intake_submission_files`

### 11.2 Supported files

V1 supports PDF only.

Limits:

- max size per file: 100 MB
- one uploaded file per `file` field

### 11.3 Attachment visibility

Reviewer/admin attachment APIs must return a merged attachment list containing:

- existing Smartsheet row attachments
- intake-upload files from `intake_submission_files`

Normalized attachment payload:

- `id`
- `name`
- `url`
- `source` (`smartsheet` or `intake_upload`)

For `intake_upload` files:

- `url` is a short-lived signed Blob URL generated server-side at request time

### 11.4 Why LINK attachments are not used

V1 does not create Smartsheet LINK attachments for uploaded files.

Reason:

- no need to expose stable public Blob URLs
- no uncertainty around LINK attachment payload differences
- reviewer/admin UI can serve private files directly from the app using signed URLs

This is the final v1 decision.

Future extension:

- if the team decides to mirror staged PDFs into Smartsheet as native `FILE` attachments later, use [smartsheet-native-attachments.md](/C:/python%20projects/vercel/scholarship-review-platform/smartsheet-native-attachments.md) as the build spec

### 11.5 Orphan cleanup

A scheduled cleanup job must:

- find Blob uploads that never reached a completed submission
- delete orphaned uploads older than 24 hours
- leave completed submission files untouched

---

## 12. Submission Processing Flow

### 12.1 Happy path

1. Client generates a UUID `submissionId`.
2. Client loads the published form via `GET /api/submit/[cycleId]`.
3. Client requests upload tokens for any `file` fields.
4. Browser uploads files directly to private Blob using the tokenized path scoped to `submissionId`.
5. Client submits metadata-only payload to `POST /api/submit/[cycleId]`.
6. Server writes/updates `intake_submissions` to `processing`.
7. Server validates the live Smartsheet schema.
8. Server creates the Smartsheet row.
9. Server updates `intake_submissions` with `row_created`.
10. Server inserts `intake_submission_files`.
11. Server marks the submission `completed`.
12. Server returns `201` with the created `rowId`.

### 12.2 Transaction and retry rules

- The initial `processing` record must be written before the Smartsheet call.
- If the request is retried with the same `submissionId`:
  - if already `completed`, return the existing success payload
  - if `processing`, reject with a retry-safe response
  - if `failed`, resume from the saved request metadata if possible

This makes the submit route idempotent.

---

## 13. Failure Handling

### 13.1 Validation failure before row creation

Behavior:

- return `400`
- keep submission status as `failed`
- do not create a row

### 13.2 Schema drift failure

Behavior:

- set submission status to `invalid_schema`
- auto-unpublish the intake form
- write an audit log entry
- return a generic `503` message to the public client

### 13.3 Smartsheet rate limit

Behavior:

- set submission status to `rate_limited`
- return `429`
- mark response as retryable

### 13.4 Row created but DB/file persistence fails

Behavior:

- keep the created `smartsheet_row_id`
- set submission status to `failed`
- preserve `request_cells_json` and `request_files_json`
- allow the same `submissionId` to resume processing without creating a second row

This is the required recovery model for partial failures.

### 13.5 Admin recovery

Admin UI must expose a failed-submissions panel for each cycle showing:

- `submission_id`
- submitter email
- current status
- row ID if created
- timestamp

Admin actions:

- retry processing
- mark resolved
- delete failed record

Admin retry must reuse the existing `submissionId` and `row_id` when present.

---

## 14. Security And PII Rules

### 14.1 Public abuse controls

Required controls:

- IP-based rate limiting using hashed IPs in Postgres
- honeypot field
- required `@wsu.edu` email suffix
- short-lived upload tokens
- PDF-only upload restriction
- 100 MB file cap
- open/close window enforcement

### 14.2 Auth model statement

The intake form is public in v1. It is not identity-proof authenticated.

The `@wsu.edu` rule is an abuse-control and policy-control measure, not proof that the submitter owns the mailbox.

This is acceptable for v1 and is not a blocker.

### 14.3 Audit logging

Audit logs for intake flows must include only operational metadata:

- cycle ID
- submission ID
- publish/unpublish events
- state transitions
- row ID
- failure category

Audit logs must not store:

- full public form payloads
- full nominee narratives
- Blob URLs
- raw file metadata beyond what is operationally required

### 14.4 Retention

- completed `intake_submissions`: retain operational metadata per normal app retention
- request payload snapshots: 30 days after completion, 90 days after failure
- `intake_rate_limit_events`: 14 days
- orphan Blob uploads: delete after 24 hours

---

## 15. Reviewer And Admin UI Integration

### 15.1 Reviewer UI

The existing reviewer workflow remains row-based.

Required changes:

- reviewer attachment endpoint merges Smartsheet attachments and intake-upload files
- reviewer attachment UI renders both sources the same way

No change is required to the core reviewer row-loading model.

### 15.2 Admin preview and troubleshooting

Admin preview routes should use the same merged-attachment model so admins can verify intake-upload visibility before release.

Cycle admin page must also show:

- intake publish status
- last published version
- schema-invalid state
- failed submission count

---

## 16. Publish Rules

Publish is allowed only when:

- all draft fields are valid
- all mapped columns exist in the current schema snapshot
- all mapped columns are supported in v1
- all select options match the target Smartsheet picklist options
- the cycle has an active Smartsheet connection and sheet ID

Publishing creates a new immutable `intake_form_versions` snapshot and updates `intake_forms.published_version_id`.

Unpublish behavior:

- public `GET /api/submit/[cycleId]` returns `404`
- public submit attempts are rejected
- historical submissions remain intact

---

## 17. Definition Of Done

The intake-form build is complete only when all of the following are true:

- admin can create, edit, publish, and unpublish an intake form
- public route serves only published versions
- public submit route is metadata-only
- direct PDF uploads to private Blob work for files up to 100 MB
- a valid submission creates exactly one Smartsheet row
- the same `submissionId` cannot create duplicate rows
- reviewer/admin attachment lists include intake-upload files
- schema drift blocks submit and auto-unpublishes the form
- public routes enforce rate limiting and `@wsu.edu` validation
- failed submissions are visible and retryable in admin UI
- no audit log stores full public form payloads

---

## 18. Implementation Order

### Phase 1

- Migration 005 tables
- `addRow` helper
- intake publish/version model
- DB-backed rate limiting

### Phase 2

- admin builder
- publish/unpublish actions
- form validation at publish time

### Phase 3

- public schema route
- upload-token route
- direct Blob uploads
- metadata-only submit route
- idempotent submission processing

### Phase 4

- reviewer/admin merged attachment APIs
- failed-submission admin recovery UI
- orphan cleanup job
- end-to-end test coverage

---

## 19. Implementation Notes

- Do not expose CONTACT_LIST or MULTI_CONTACT_LIST in the builder for v1.
- Do not use Smartsheet URL attachments in v1.
- Do not let the public route read mutable draft config.
- Do not proxy file bodies through Vercel Functions.
- Do not store raw IPs.
- Do not add `--webpack` to this repo unless a reproduced build regression requires it.

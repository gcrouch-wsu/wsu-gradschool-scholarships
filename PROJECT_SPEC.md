# Project Specification: Workflow Review Platform

Canonical product/spec document for this repo. For setup and deployment, see `README.md` and `instruction.md`.

---

## Spec revision

- **Last updated:** 2026-03-25
- **Meaning:** This date marks the spec baseline aligned with the **current build** and stated expectations. When behavior or scope changes materially, update the relevant sections and bump this date.

---

## Platform Purpose

This app is a workflow layer on top of Smartsheet. It supports programs that keep structured row data in Smartsheet while the app owns workflow state, reviewer experience, public intake, files, assignments, and audit history.

The initial use case is graduate scholarship nomination review, but the platform is intentionally general enough for grants, requests, and similar review-cycle workflows.

Smartsheet remains the source of truth for structured row data. Postgres stores users, sessions, assignments, builder configuration, published snapshots, submission lifecycle state, file metadata, and audit logs. Vercel Blob stores uploaded files privately.

---

## Technical Architecture

- Framework: Next.js App Router on Vercel
- Build command: `vercel.json` runs `npm run build` -> `next build` (Turbopack on Next.js 16)
- Styling: Tailwind CSS v4
- Auth: custom DB-backed sessions with bcrypt
- Storage: PostgreSQL (app state), Smartsheet (row data), Vercel Blob (private uploads)
- Encryption: AES-256-GCM for Smartsheet credentials via `ENCRYPTION_KEY`
- Runtime: routes using `pg`, crypto, Blob tokens, or ZIP streams should explicitly export `runtime = "nodejs"`

### Build guardrails

- `npm run build` is the source of truth for what Vercel executes.
- Do not add `--webpack` unless a reproduced production-build regression justifies it.
- Run `npx tsc --noEmit` when touching shared types, route contracts, or layout persistence.
- Run `npm test` when changing auth, file handling, layout logic, or Smartsheet read/write paths.

---

## Database Schema

Migrations live in `supabase/migrations/`.

| Migration | Key tables / changes |
|---|---|
| `001_initial_schema.sql` | `users`, `sessions`, `scholarship_programs`, `connections`, `scholarship_cycles`, `roles`, `scholarship_memberships`, `field_configs`, `field_permissions`, `view_configs`, `config_versions`, `audit_logs`, `user_cycle_progress`, `app_config` |
| `002_program_admins.sql` | `program_admins` |
| `003_scholarship_templates.sql` | `scholarship_templates` |
| `004_program_connections.sql` | program-scoped Smartsheet connections |
| `005_intake_forms.sql` | `intake_forms`, `intake_form_fields`, `intake_form_versions`, `intake_submissions`, `intake_submission_files`, `intake_rate_limit_events` |
| `006_reviewer_row_files.sql` | `reviewer_row_files` for reviewer-uploaded attachments |
| `007_layout_json.sql` | `layout_json` on `intake_forms` and `view_configs` |
| `008_reviewer_field_help_text.sql` | `help_text` on reviewer `field_configs` |
| `009_enable_public_rls.sql` | enables RLS on app-owned public tables to block unintended Supabase Data API exposure |
| _(next sequential)_ | native Smartsheet attachment mirroring changes described below |

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `ENCRYPTION_KEY` | Yes | encryption key for Smartsheet tokens, IP hashing, and signed file URLs |
| `NEXT_PUBLIC_APP_URL` | Yes in production | public app base URL for live-form links and signed file routes |
| `BLOB_READ_WRITE_TOKEN` | Yes for file features | intake uploads, reviewer uploads, cleanup, signed access, ZIP export |
| `CRON_SECRET` | Yes for cron routes | protects cleanup and background job routes |
| `ALLOWED_REVIEWER_EMAIL_DOMAIN` | No | default reviewer-assignment domain restriction |
| `SEED_ADMIN_EMAIL` | No | local bootstrap admin email |
| `SEED_ADMIN_PASSWORD` | Local only | password for the initial seeded admin |

---

## Smartsheet API Rules

- Never send `value: null`. Use `""` to clear.
- Column type normalization: `column.type ?? column.columnType ?? "TEXT_NUMBER"`.
- Surface `httpStatus` and `errorCode` on Smartsheet failures, especially `429` / `4003`.
- PICKLIST writes use `strict: true`.
- CONTACT_LIST / MULTI_CONTACT_LIST are out of scope for public intake writes.
- MULTI_CONTACT_LIST clearing must use `{ "value": "" }`, not `values: []`.
- Smartsheet LINK attachments are not used. The only future attachment push path is native `FILE` mirroring.

---

## Working Rules

1. When a fix ships, move it from Remaining / Next Build into Fixes Applied.
2. Any change to Smartsheet write helpers must be evaluated against the rules above.
3. Watch for smart quotes or other non-ASCII punctuation in JSX after AI/editor edits.
4. Use `npx tsc --noEmit` as a fast precheck; treat `npm run build` as the final local verifier.
5. Do not add `--webpack` unless a reproduced production-build regression is documented.

---

## What Is Built

- Admin dashboard: programs, cycles, connections, users, reviewer assignments, templates
- **Program and cycle rename:** admins can change a program's `name` and `description` inline from the program detail page and a cycle's display label from the cycle detail page; program slug remains immutable after create
- Two-tier admin model: platform admin vs program admin
- Cycle setup: Smartsheet connection, sheet sync, cycle status, external reviewer options
- Reviewer builder: column mapping, purposes, field-level blind hide flags, optional per-field helper text, multi-role management, per-role view/edit permissions matrix with inline meaning guidance, row-based layout with 1/2/3-up desktop rows and drag row reorder, publish/unpublish, version snapshots, import/export/clone, delete/reset
- Public intake builder: draft/publish/unpublish, versioned snapshots, rich-text instructions, multi-file PDF uploads, delete guard, optional character limits for `short_text` and `long_text`, short-vs-narrative text input style for mapped Smartsheet text columns, row-based desktop layout with 1/2/3-up rows and drag row reorder
- Public submit workflow: direct Blob uploads, metadata-only submit route, Smartsheet row creation, submission idempotency, schema-drift detection, rate limiting, honeypot
- Reviewer workflow: direct routing into applicant pages, progress tracking, Save and Next, merged attachment view, reviewer-uploaded attachments, per-role field visibility/editability, field-level blind hiding that overrides reviewer access at runtime, helper text/instructions, reviewer sign-out in the shell header, published-layout rendering from canonical `layout_json`
- Admin preview and export: role-scoped reviewer preview config, merged attachments, ZIP export of intake attachments
- Audit logging, encrypted Smartsheet credentials, DB-backed sessions, and app-controlled signed file access

---

## Naming: scholarships and cycles (admin)

Scholarships in the UI correspond to **`scholarship_programs`** in the database. Cycles are **`scholarship_cycles`** under a program.

| Item | Status | Behavior |
|---|---|---|
| **Cycle display name** | Shipped | Rename from the cycle admin page; updates **`cycle_label`** only. |
| **Scholarship (program) name** | Shipped | Admins with access to the program can update **`name`** and **`description`** inline without recreating the program. Program names do not need to be unique across programs. |
| **Program slug** | **Immutable after create** | Slug is set at creation and cannot be changed. Only `name` and `description` are mutable. The rename UI does not show the slug field. |
| **Description** | Shipped | `description` is a nullable text column. Clearing it saves `NULL`. The edit form shows the description field; empty input is saved as `NULL`. |

**Authorization:** `canManageProgram` - platform admins for any program; program admins only for programs in **`program_admins`**.

**Implementation:** `PATCH /api/admin/programs/[programId]` accepts `name` (required, non-empty) and `description` (optional, nullable). It updates only `name` and `description`, returns the updated record, and writes `program.updated` only when at least one field changed. The program detail page exposes an inline edit form for name and description, supports Enter/Escape keyboard handling, saves via PATCH, and refreshes server-rendered data in place without navigation.

**Acceptance criteria:**

- [x] `PATCH /api/admin/programs/[programId]` accepts `name` and `description`, returns the updated record, and rejects empty `name` with a 422.
- [x] The program detail page shows an inline-editable name and description; saving calls the PATCH and updates the displayed value without a full page reload.
- [x] Submitting with no change is a no-op (no audit event written).
- [x] An audit log entry is written on each successful update with actor, program ID, and before/after values of changed fields.
- [x] Slug is not shown as an editable field anywhere in the rename UI.
- [x] Program admins can rename only programs they administer; platform admins can rename any program.

**Non-goals (this build):**
- Slug mutation - no UI or API path changes a slug.
- Cascading rename effects on cycle display names or reviewer configs.
- Notifications to other program admins on rename.

---

## Reviewer roles, permissions, and assignment

Reviewer roles, field permissions, and role-scoped preview are now shipped on cycles using the existing `roles`, `field_permissions`, `field_configs`, `config_versions`, and `scholarship_memberships` tables.

| Area | Current behavior |
|---|---|
| **Roles per cycle** | New cycles still seed one default role (`reviewer` / `Reviewer`). Admins can add roles up to the 10-role cap, rename role labels, and delete roles when delete guards pass. Existing role keys stay immutable after create. |
| **Per-role field mapping** | The reviewer builder exposes a field x role matrix with `can_view` / `can_edit`. Saves preserve explicit per-role overrides rather than collapsing everything back to purpose defaults. |
| **Permission defaults** | New score/comment fields default to hidden and read-only for all roles. Other new fields default to visible and read-only. Newly added roles default to hidden and read-only on existing fields until the admin grants access. |
| **Assignment** | Cycle-page assignment links one user to exactly one role on that cycle. The dropdown shows the cycle's current roles. Domain and external-reviewer rules still apply. |
| **Reviewer runtime** | Live reviewer APIs resolve the effective published config, filter fields by the member's `role_id`, apply field-level blind hiding and layout omission, and reject writes to fields the role cannot edit. Blind-hidden fields are neither viewable nor editable in live reviewer runtime. |
| **Admin preview** | Admin preview can simulate a selected role so visibility and read-only behavior can be checked before publish. |
| **Clone / import / export / templates** | Exported configs, imported configs, clone operations, and saved templates include roles plus field permissions. Import merges roles by key and preserves permissions where the target cycle can resolve the referenced field and role. |
| **Nominee list** | Still cycle-wide. Reviewer roles do not introduce per-row reviewer assignment. |
| **Public intake** | Still one intake form per cycle. Reviewer roles do not branch the public form. |

**Caveats unchanged:** Smartsheet users with full sheet access bypass app-side hiding. External-reviewer and email-domain rules still govern who may be assigned.

### Remaining reviewer-role polish

- Add explicit reorder controls in the builder UI for `sort_order`.
- Improve delete-in-use UX by offering reassignment flow when active memberships block role deletion, instead of a hard stop only.
- Decide whether finer-grained `field_permission` audit events are needed beyond the shipped role CRUD audits plus aggregate config-save/config-publish auditing.
- Keep per-row reviewer assignment, cross-cycle role libraries, and reviewer-visible role labels out of scope unless a later spec adds them.

---

## Fixes Applied

1. Serverless DB pool guardrails in `src/lib/db.ts`
2. Smartsheet null coercion and structured write handling in `src/lib/smartsheet.ts`
3. Structured Smartsheet error parsing with surfaced `httpStatus` and `errorCode`
4. Rate-limit passthrough on reviewer and intake write paths
5. Intake submission idempotency and schema-drift handling
6. Private file storage with app-controlled signed access
7. Attachment ZIP export hardening: streamed ZIPs from private Blob with sanitized entry naming
8. Row-based layout persistence and rendering: `layout_json` is canonical for intake and reviewer layouts
9. Reviewer published-layout canonicalization: published reviewer configs rebuild from saved `layout_json` instead of stale snapshot section metadata
10. Reviewer attachment-layout validation fix: live/admin preview layout validation now includes attachment field keys, preventing silent fallback to single-column rendering
11. Program rename shipped: inline editing of `name` and `description` on the program page with `program.updated` audit logging and immutable slug handling
12. Reviewer roles shipped: cycle-scoped role CRUD, per-role permission matrix, role-scoped preview, published-snapshot enforcement, and import/export/clone/template support
13. Reviewer helper text shipped: optional `help_text` on reviewer fields persists through builder save, preview, live reviewer runtime, import/export, and clone
14. Intake text-question character limits shipped: optional per-field limits for `short_text` and `long_text` render live counters in the public form and are enforced server-side
15. Blind-review controls simplified: blind-hidden reviewer fields are configured only in the reviewer builder, and blind always overrides reviewer view/edit access in preview and live runtime
16. Shared row-layout editor supports drag reorder for both intake and reviewer layouts, with Up/Down controls retained as a fallback
17. Intake narrative text support shipped: mapped Smartsheet text questions can use short or long narrative input style, and large character-limit text questions render as multiline resizable textareas on the public form
18. Schema sync refresh shipped: syncing Smartsheet columns now refreshes draft reviewer/intake mapped metadata, including derived labels and intake picklist options where they still mirror Smartsheet
19. Shared reviewer/admin sign-out shipped: the reviewer shell now includes a logout control, and the reviewer header only shows `Admin` when the signed-in user actually has admin access
20. Public-table RLS hardening shipped: app-owned tables in `public` now enable RLS by migration so Supabase Security Advisor no longer treats them as exposed without row controls

---

## Current Layout System

The row-based layout refactor is shipped. Intake and reviewer now share the same persisted layout model and runtime rules.

### Persisted layout contract

```ts
type LayoutWidth = "full" | "half" | "third";

interface SavedLayoutItem {
  item_key: string;
  field_key: string;
  width: LayoutWidth;
}

interface SavedLayoutRow {
  row_key: string;
  items: SavedLayoutItem[];
}

interface SavedLayoutSection {
  section_key: string;
  label: string;
  sort_order: number;
  rows: SavedLayoutRow[];
}

interface SavedLayoutJson {
  version: 1;
  sections: SavedLayoutSection[];
  pinned_field_keys?: string[];
}
```

### Current rules

| Area | Current behavior |
|---|---|
| Layout structure | `sections -> rows -> items` |
| Desktop row shapes | exactly one `full`, or two `half`, or three `third` items |
| Mobile rendering | all items stack vertically in row order |
| Intake persistence | `intake_forms.layout_json` -> `intake_form_versions.snapshot_json.layout_json` |
| Reviewer persistence | `view_configs.layout_json` -> `config_versions.snapshot_json.layout_json` |
| Reviewer pinned fields | stored in `layout_json.pinned_field_keys` and rendered outside section rows |
| Section ordering | array order is canonical; `sort_order` mirrors array index on save |
| Row reordering | shared row-layout editor supports drag-and-drop row reorder, with Up/Down controls as a fallback |
| Runtime fallback | malformed rows degrade to safe full-width rendering rather than crashing |

### Reviewer-specific notes

- Published reviewer configs resolve from the effective published snapshot first.
- When a snapshot includes `layout_json`, that layout is the canonical source for section ordering and row placement.
- Blind-hidden fields are configured per field in the reviewer builder; there is no separate cycle-level blind toggle.
- Blind-hidden fields can be retained in saved layouts, but they are omitted from rendered reviewer forms at runtime.

---

## Next Build: Smartsheet Native Attachment Mirroring

### Purpose and design decisions

When an admin enables "Push to Smartsheet" on an intake attachment field, uploaded PDFs from that field should be mirrored into Smartsheet as native `FILE` attachments on the submission row.

- Blob remains the upload/staging layer for all programs
- Sync is asynchronous; submission success is not coupled to Smartsheet attachment API availability
- Each attachment field opts in independently
- The 30 MB Smartsheet file size limit applies only to push-enabled fields
- Blob-only fields retain the current 100 MB cap
- ZIP export remains the primary long-term archive path and works regardless of mirroring

| Area | Decision |
|---|---|
| Toggle location | per-field checkbox in intake builder field properties |
| Storage layer | Blob first; Smartsheet is the mirror target |
| Attachment type | native `FILE` attachments only |
| Sync timing | asynchronous background worker; never inline in the submit route |
| Submission success | row creation + DB persistence; sync failure does not invalidate the submission |
| Blob retention after sync | 24 hours after confirmed Smartsheet sync |
| Failed file retention | 7 days after the last sync attempt |

### Data model changes

Migration placeholder: `010_smartsheet_attachment_sync.sql` unless another migration ships first.

Add to `intake_form_fields`:

```sql
push_to_smartsheet BOOLEAN NOT NULL DEFAULT FALSE
```

Only meaningful on file-type intake fields.

Add to `intake_submission_files`:

```sql
attachment_sync_status   VARCHAR(30) NOT NULL DEFAULT 'not_applicable'
smartsheet_attachment_id BIGINT
smartsheet_attachment_name VARCHAR(255)
sync_attempt_count       INT NOT NULL DEFAULT 0
last_sync_attempt_at     TIMESTAMPTZ
synced_at                TIMESTAMPTZ
next_sync_attempt_at     TIMESTAMPTZ
sync_error_json          JSONB
blob_delete_after        TIMESTAMPTZ
blob_deleted_at          TIMESTAMPTZ
```

Allowed `attachment_sync_status` values:

| Value | Meaning |
|---|---|
| `not_applicable` | push disabled for that field |
| `pending` | queued, not yet claimed |
| `syncing` | claimed by the current worker run |
| `synced` | successfully attached to Smartsheet |
| `retryable_failed` | transient failure; should retry |
| `permanent_failed` | exhausted or non-retryable failure |
| `deleted_from_blob` | Blob staging object removed after confirmed sync |

Add to `intake_submissions`:

```sql
attachment_sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'
```

Aggregate values: `not_applicable`, `pending`, `partial`, `synced`, `failed`.

### File size and upload rules

- If `push_to_smartsheet = false`, enforce the current 100 MB limit
- If `push_to_smartsheet = true`, enforce a 30 MB limit at upload-token issuance
- Public form UI must show the correct limit per field
- PDF only regardless of push setting

### Worker design

Route: `GET /api/admin/jobs/sync-smartsheet-attachments`  
Protection: `CRON_SECRET`  
Schedule: Vercel cron every 1 minute

Each run should select files where:

- `attachment_sync_status IN ('pending', 'retryable_failed')`
- `next_sync_attempt_at IS NULL OR next_sync_attempt_at <= now()`
- work is grouped by Smartsheet connection token
- max 5 files per connection per run

Before selecting new files, reset stale `syncing` rows older than 10 minutes back to `retryable_failed`.

Claim work atomically:

```sql
UPDATE intake_submission_files
SET attachment_sync_status = 'syncing',
    last_sync_attempt_at = now(),
    sync_attempt_count = sync_attempt_count + 1
WHERE id = $id
  AND attachment_sync_status IN ('pending', 'retryable_failed')
RETURNING *
```

Retry/backoff policy:

- attempt 1: immediate
- attempt 2: +5 minutes
- attempt 3: +30 minutes
- attempt 4: +2 hours
- maximum 4 attempts

Retryable failures include Smartsheet `429`, transient `5xx`, and network timeouts. Permanent failures include missing Blob objects, oversized files, missing Smartsheet row IDs, revoked credentials, or non-`429` `4xx` errors.

### Smartsheet API layer

Add `attachFileToRow(...)` in `src/lib/smartsheet.ts`:

- accepts token, sheet ID, row ID, filename, content type, and a stream/blob source
- uses `multipart/form-data`
- returns structured `httpStatus`, `errorCode`, and `attachmentId`

Duplicate prevention requires both:

1. If `smartsheet_attachment_id` is already set, skip the attach call and treat the file as synced.
2. On retries, query row attachments and match by filename and file size so a crash between Smartsheet success and DB update does not create duplicates.

### Attachment API behavior

Reviewer and admin attachment APIs should continue to return a merged list.

Normalized payload shape:

| Field | Values |
|---|---|
| `id` | attachment or file row ID |
| `name` | filename |
| `url` | Smartsheet URL or a fresh signed Blob URL |
| `source` | `smartsheet`, `intake_upload_pending`, `intake_upload_failed`, `intake_upload_blob_only` |
| `syncStatus` | opaque sync state, admin-only for failed states |
| `isFallback` | boolean |

Rules:

- `pending` and `syncing` both surface as `intake_upload_pending`
- signed Blob URLs for fallback entries must be generated at read time
- once a synced Smartsheet attachment exists, do not also show a duplicate Blob fallback entry
- blob-only files continue to work exactly as they do now

### Admin UX changes

In the intake builder, attachment fields should show:

- checkbox: `Push uploaded files to Smartsheet as native attachments`
- note: `Files from this field will be mirrored to Smartsheet after submission. Maximum file size is 30 MB.`
- file-size copy updates from 100 MB to 30 MB when enabled

Admin submission tooling should show aggregate sync status and counts for push-enabled files, plus recovery actions:

- `Retry attachment sync`
- `Mark attachment failure resolved`
- `View staged file`

### Cleanup rules

Pending orphans:

- delete staged files that never reached a completed submission after 24 hours
- never touch file rows that belong to a completed `intake_submissions` record

Synced file cleanup:

- only delete staged Blob files when all of these are true:
  - `attachment_sync_status = 'synced'`
  - `smartsheet_attachment_id IS NOT NULL`
  - `blob_delete_after <= now()`
  - `blob_deleted_at IS NULL`

Failed file cleanup:

- retain `permanent_failed` staged files for 7 days after `last_sync_attempt_at`
- then allow cleanup if they are still `permanent_failed` and `blob_deleted_at IS NULL`

Files with `attachment_sync_status = 'not_applicable'` are never touched by sync cleanup.

### Recommended build order

1. Add the next migration with `push_to_smartsheet` on `intake_form_fields`
2. Add the attachment-field toggle in the intake builder
3. Enforce the 30 MB cap at upload-token issuance when mirroring is enabled
4. Add `attachFileToRow(...)` in `src/lib/smartsheet.ts`
5. Add sync-status fields and aggregate updates in `src/lib/intake.ts`
6. Add the cron worker route with atomic claiming, stale-sync recovery, backoff, and duplicate guard
7. Update reviewer/admin attachment APIs to prefer synced Smartsheet entries while still serving Blob fallbacks
8. Add admin submission visibility and retry tooling
9. Extend cleanup to delete staged Blobs only after confirmed sync

---

## Remaining: Test Coverage

Still worth adding:

- attachment export end-to-end behavior
- reviewer upload flows
- layout-builder save/publish edge cases
- intake publish/save/delete paths
- admin reset/delete safety flows
- attachment sync worker tests once native mirroring is built

---

## Remaining: UX and Accessibility Polish

- mobile reviewer usability
- builder discoverability and empty states
- large-export user feedback
- admin recovery/error messaging around file-heavy workflows
- keyboard accessibility polish for the row-layout canvas

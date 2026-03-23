# Project Specification: Workflow Review Platform

Canonical product/spec document for this repo. For setup and deployment, see `README.md` and `instruction.md`.

---

## Spec revision

- **Last updated:** 2026-03-23
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
| _(schema note)_ | **Multi-role reviewer UI** (see Next build: Reviewer roles…) should use existing **`roles`** and **`field_permissions`**; add a migration only if new columns or constraints are required. |
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
- **Cycle rename:** admins can change a cycle’s display label from the cycle detail page (in-place rename of `cycle_label`)
- Two-tier admin model: platform admin vs program admin
- Cycle setup: Smartsheet connection, sheet sync, cycle status, blind-review settings, external reviewer options
- Reviewer builder: column mapping, purposes, blind-review hide flags, row-based layout with 1/2/3-up desktop rows, publish/unpublish, version snapshots, import/export/clone, delete/reset (**multi-role management and per-role field permissions are not yet exposed in admin UI** — see **Next build: Reviewer roles, permissions matrix, and assignment**)
- Public intake builder: draft/publish/unpublish, versioned snapshots, rich-text instructions, multi-file PDF uploads, delete guard, row-based desktop layout with 1/2/3-up rows
- Public submit workflow: direct Blob uploads, metadata-only submit route, Smartsheet row creation, submission idempotency, schema-drift detection, rate limiting, honeypot
- Reviewer workflow: direct routing into applicant pages, progress tracking, Save and Next, merged attachment view, reviewer-uploaded attachments, published-layout rendering from canonical `layout_json`
- Admin preview and export: preview config, merged attachments, ZIP export of intake attachments
- Audit logging, encrypted Smartsheet credentials, DB-backed sessions, and app-controlled signed file access

---

## Naming: scholarships and cycles (admin)

Scholarships in the UI correspond to **`scholarship_programs`** in the database. Cycles are **`scholarship_cycles`** under a program.

| Item | Status | Behavior |
|---|---|---|
| **Cycle display name** | Shipped | Rename from the cycle admin page; updates **`cycle_label`** only. |
| **Scholarship (program) name** | Specified | Admins with access to the program must be able to update **`name`** and **`description`** without recreating the program. Program names do not need to be unique across programs. |
| **Program slug** | **Immutable after create** | Slug is set at creation and cannot be changed. Only `name` and `description` are mutable. The rename UI does not show the slug field. |
| **Description** | Specified | `description` is a nullable text column. Clearing it saves `NULL`. The edit form shows the description field; empty input is saved as `NULL`. |

**Authorization:** `canManageProgram` — platform admins for any program; program admins only for programs in **`program_admins`**.

**Implementation:** `PATCH /api/admin/programs/[programId]` accepts `name` (required, non-empty) and `description` (optional, nullable). Returns the updated record. UI: inline edit on the program detail page, consistent with the in-place cycle rename pattern. Save calls the PATCH and updates the displayed name without full navigation. An audit log entry is written on every successful update recording `actor_user_id`, `program_id`, and the before/after values of each changed field. No audit entry is written if neither field changed.

**Acceptance criteria (rename is complete when):**

- [ ] `PATCH /api/admin/programs/[programId]` accepts `name` and `description`; returns the updated record; rejects empty `name` with a 422.
- [ ] The program detail page shows an inline-editable name and description; saving calls the PATCH and updates the displayed value without a full page reload.
- [ ] Submitting with no change is a no-op (no audit event written).
- [ ] An audit log entry is written on each successful update with actor, program ID, and before/after values of changed fields.
- [ ] Slug is not shown as an editable field anywhere in the rename UI.
- [ ] Program admins can rename only programs they administer; platform admins can rename any program.

**Non-goals (this build):**
- Slug mutation — no UI or API path changes a slug.
- Cascading rename effects on cycle display names or reviewer configs.
- Notifications to other program admins on rename.

---

## Reviewer roles and assignment: current state

The database already has **`roles`**, **`field_permissions`**, **`field_configs`**, and **`scholarship_memberships`**, but the **shipped admin experience** does not yet deliver the full workflow below.

| Area | Shipped today |
|---|---|
| **Roles per cycle** | New cycles receive **one** default role (`reviewer` / “Reviewer”). There is **no admin UI** to add, rename, reorder, or remove additional roles. |
| **Per-role field mapping** | Columns are mapped to **`field_configs`** with purposes and blind flags, but there is **no matrix (or equivalent)** to set **per role** `can_view` / `can_edit` per field. Saving the builder effectively aligns editability with **purpose** across all roles for that cycle. |
| **Assignment** | Cycle page **Assigned reviewers**: pick **user** + **role**. Only **one** role exists in the dropdown until multiple roles exist in data. |
| **Reviewer runtime** | APIs already filter fields by the member’s **`role_id`** and **`field_permissions`** when those rows exist and differ. |
| **Nominee list** | **Cycle-wide**: assigned reviewers see **all** rows for the cycle (no per-row assignment in this build). |
| **Public intake** | **Single** intake per cycle; not duplicated per reviewer role. |

**Caveats unchanged:** Smartsheet users with full sheet access bypass app-side hiding; external-reviewer and email-domain rules still apply to who may be assigned.

---

## Next build: Reviewer roles, permissions matrix, and assignment

Fully specified product build to close the gap between the **data model** and **admin + reviewer UX**. No implementation detail here beyond behavioral and data requirements.

### 1. Goals

| # | Goal |
|---|---|
| G1 | Program admins (and platform admins) can define **multiple reviewer roles** per cycle (e.g. “Reviewer 1”, “Reviewer 2”) with stable identity and display names. |
| G2 | For each mapped reviewer field, admins can set **per role** whether the role may **view** and/or **edit** that field, independent of other roles. |
| G3 | Assignment continues to link **user + cycle + exactly one role**; the role dropdown lists **all** roles for that cycle. |
| G4 | Live reviewers see only fields their role may view; writes only where their role may edit—consistent with published config and Smartsheet rules. |
| G5 | **Blind review** and **layout** (`layout_json`) remain compatible: role permissions further restrict what is shown; blind flags still apply on top of visibility where specified. |
| G6 | **Clone / import / export** of reviewer configuration preserves **roles** and **permission rows** with correct rebinding when cycle or role IDs change. |

### 2. Role creation and management

**Authorization:** `canManageCycle` for all role CRUD operations (program admins for their programs, platform admins for any).

| Requirement | Specification |
|---|---|
| **Location** | Roles are managed in the **reviewer builder** (cycle-scoped). The cycle admin page may display the role list for context but role CRUD is initiated from the builder. Single source of truth: the builder. |
| **Fields per role** | **`key`**: unique within the cycle, stable identifier. Format: lowercase letters, digits, and hyphens only; must start with a letter; 1–50 characters. **`label`**: human-readable display name shown in assignment dropdowns and the matrix header. **`sort_order`**: integer controlling display order in dropdowns and matrix columns. |
| **Minimum / maximum** | At least **one** role per cycle at all times (enforced). Maximum **10** roles per cycle (enforced; reject create with a clear error if at cap). |
| **Default for new cycles** | Seed one default role (`key: "reviewer"`, `label: "Reviewer"`). Admin may rename its label. The default key cannot be changed (same key-immutability rule as all roles). |
| **Create** | Admin supplies a label; `key` is auto-generated from the label (slugified, unique within cycle). Admin may override the generated key before first save. Reject duplicate keys per cycle with a clear error. |
| **Rename label** | Allowed anytime. Does not change `key`, `id`, membership linkage, or `field_permissions` rows. |
| **Change key** | **Disallowed after creation.** `key` is shown read-only after the role is saved. To use a different key, delete and recreate the role (subject to delete rules). |
| **Delete** | **Blocked** if it is the only remaining role. **Blocked** if `scholarship_memberships` reference the role — show a modal listing affected users with a reassign-to dropdown (all other roles in the cycle); admin must reassign all before delete proceeds. **Blocked** if an unpublished draft `config_versions` snapshot references the role — show an error instructing admin to re-save the reviewer builder first. Soft-delete / archive is out of scope. |
| **Reorder** | Drag or arrow controls update `sort_order` for all roles in a single save. IDs and keys are unchanged. |

### 3. Field mapping and permissions matrix

| Requirement | Specification |
|---|---|
| **Concept** | For each **`field_config`** on the cycle, for each **`role`** on the cycle, there is at most one **permission** row: **`can_view`**, **`can_edit`**. |
| **Invariant** | **`can_edit` ⇒ `can_view`**: when admin checks **edit**, **view** is automatically coerced to checked. When admin unchecks **view**, **edit** is automatically coerced to unchecked. The UI enforces this silently — no validation error. |
| **Independence** | Editability is not inferred from purpose for all roles at save time. Purpose may provide **defaults** when a field is first mapped or a new role is added, but admins must be able to override per role. |
| **UI pattern** | A dedicated **matrix** (rows = fields, columns = roles) with **view** and **edit** checkboxes per cell, rendered in the reviewer builder below or alongside the existing field list. |
| **Save interaction** | The matrix saves when the admin clicks the existing **Save** button in the reviewer builder. Save persists the full `field_permissions` matrix without collapsing to purpose-only defaults. The matrix is not auto-saved on checkbox change. |
| **Publish interaction** | Publish snapshots the current `roles` and full `field_permissions` matrix into `config_versions`. Publish is **not blocked** by incomplete permissions (all-unchecked = no access, which is valid). If any role has no view access on any field, publish shows a **non-blocking warning banner** listing the affected roles; admin confirms to proceed. |
| **New mapped column** | On add: default all roles to **view = true, edit = false** for metadata-purpose fields; **view = false, edit = false** for score/rubric-purpose fields. The new field's matrix row is highlighted (e.g. yellow background) until the admin explicitly saves. |
| **New role** | When a role is added after fields exist: default all fields to **view = false, edit = false** for the new role. The new role's matrix column is highlighted until the admin explicitly saves. |
| **Attachment / special purposes** | Same matrix applies. Attachment upload permission follows `can_edit` for the attachment field in that role's permission row. |
| **Blind review** | Fields marked blind-hidden remain hidden for every role that would otherwise see them. Blind flags are applied after role ACL (intersection). |
| **Pinned fields** | Fields in `layout_json.pinned_field_keys` that a role cannot view are **omitted** from the pinned section for that role. Pinned rendering follows the same role ACL as section-row rendering. |
| **Published snapshot** | `config_versions` snapshot includes the `roles` array and the full `field_permissions` matrix. Live reviewer APIs derive permissions from the effective published snapshot, not live DB rows. |

### 4. Assignment (users to roles)

| Requirement | Specification |
|---|---|
| **Who** | Same as today: **`canManageCycle`** (program admin for that program or platform admin). |
| **Pairing** | **`scholarship_memberships`**: one row per **`(cycle_id, user_id)`** with **`role_id`**; changing assignment updates **`role_id`**. |
| **Dropdown** | Role list = all roles for the cycle, ordered by **`sort_order`** then label. |
| **Many users, one role** | **Allowed** (e.g. two people both “Reviewer 1” if process allows). |
| **One user, multiple roles** | **Not allowed** on the same cycle (same as today: one membership per user per cycle). |
| **Domain / external rules** | Unchanged: respect **`allow_external_reviewers`** and **`ALLOWED_REVIEWER_EMAIL_DOMAIN`** when assigning. |
| **Validation** | Reject assignment to a **`role_id`** not belonging to the cycle. Surface clear errors for inactive users. |

### 5. Reviewer runtime behavior

| Requirement | Specification |
|---|---|
| **Config load** | Reviewer config and row payloads use the **effective published** snapshot; filter `field_configs` by `field_permissions` for the member’s `role_id`. |
| **Layout** | `layout_json` may reference fields a role cannot view: **omit** those fields from the rendered layout for that role. No empty placeholders — omit is the default and the only supported behavior in this build. |
| **Writes** | Reject PATCH/POST of column values the role cannot **edit** with a 403, enforced server-side. UI suppression of edit controls is additive, not a substitute. |
| **Nominee list** | Still **all rows** on the sheet for the cycle unless a future spec adds row-level filters. |

### 6. Admin preview

| Requirement | Specification |
|---|---|
| **Preview as role** | Admin preview of the reviewer form must allow selecting **which role** to simulate so admins verify Rev 1 vs Rev 2 (and others) **before** publish. |
| **Visibility parity** | Fields visible in preview for a role must match exactly what the live reviewer API returns for that role: same role ACL, same blind-review flags, same layout omissions. |
| **Write affordance parity** | Fields the role cannot edit must appear read-only (or as display-only text) in preview, consistent with how the live reviewer experience suppresses editing. Preview does not make real writes. |

### 7. Clone, import, export, templates

| Requirement | Specification |
|---|---|
| **Clone config** | Copy **roles** (new IDs, same `key`/`label`/`sort_order`) and **field_permissions** rebound to new `field_config` IDs. Clone **replaces** any existing roles and permissions on the target cycle; show a confirmation prompt if the target cycle already has roles before proceeding. |
| **Export** | Serialized config includes the `roles` array and the full `field_permissions` matrix keyed by `(field_key, role_key)`. |
| **Import — roles** | Match imported roles to the target cycle's existing roles by `key`. If a matching `key` exists: update `label` and `sort_order`. If the `key` does not exist and the cycle is under the 10-role cap: create it. If the `key` does not exist and the cycle is at cap: skip that role and warn the admin. |
| **Import — field permissions** | Match field permissions to `field_configs` by `field_key`. If a `field_key` from the import does not exist in the target cycle's mapped columns: skip that permission row and list the skipped fields in a post-import warning. If the permission row references a role `key` that was skipped (cap exceeded): skip that permission row too. |
| **Templates** | Templates that carry reviewer defaults must include a `roles` array and `field_permissions` patterns. On apply, follow the same import rules above. |

### 8. Audit and observability

| Requirement | Specification |
|---|---|
| **Events** | Audit log entries for: role created / label updated / deleted; `field_permission` row created / updated / deleted (record old and new `can_view`/`can_edit` values per row); membership created / role updated / removed; reviewer config saved (one aggregated event per save with the resulting version number). |
| **Actor** | Store **`actor_user_id`**, **`cycle_id`**, and **`program_id`** on every event. |

### 9. Acceptance criteria (build is complete when)

- [ ] Admin can create **≥ 2** roles on a cycle (up to 10) and see them in the assignment dropdown ordered by `sort_order`.
- [ ] Admin can set **Rev 1** score fields **view/edit** for role A only and **no view** for role B, and **Rev 2** fields the inverse, with **shared** metadata **view** (and edit only where intended) for both.
- [ ] Saving the reviewer builder **does not** overwrite careful per-role permissions with a single-purpose rule for all roles.
- [ ] Assigned user with role A **never** receives another role’s restricted fields in reviewer GET APIs.
- [ ] A PATCH/POST from a reviewer with role A that targets a field their role cannot edit is **rejected server-side with a 403**, regardless of what the UI shows.
- [ ] Assignment respects domain / external reviewer flags.
- [ ] Clone preserves multi-role + permissions; import preserves roles and permissions, skipping unresolvable field keys with a post-import warning.
- [ ] Admin preview renders **as a selected role**: fields the role cannot view are omitted; fields the role cannot edit appear read-only.
- [ ] Audit log entries are written for role create/label-update/delete, `field_permission` changes, membership changes, and config save events.
- [ ] Documentation / operator help updated (or `README` / `instruction.md` cross-links) so the workflow matches the UI.

### 10. Non-goals (this build)

- **Per-row reviewer assignment** (different reviewers per nominee row); **`filter_criteria_json`** on memberships remains reserved / unused unless a later spec defines it.
- **Automatic** role creation from Smartsheet column prefixes (e.g. “Rev 1 —“) — optional future convenience only.
- Changing **Smartsheet** sharing or column-level security (app cannot enforce secrecy against sheet owners).
- **Cross-cycle role sharing** — roles are always scoped per cycle; no global role library in this build.
- **Reviewer-facing role display** — showing the reviewer their own role name in the reviewer UI is out of scope unless a later spec adds it.

### 11. Recommended build order

1. Role CRUD API + cycle admin UI (list, add, rename label, reorder, safe delete).  
2. Permissions matrix in reviewer builder + persist **`field_permissions`** without collapsing to purpose-only rules.  
3. Reviewer GET/POST routes: enforce matrix + layout omission rules.  
4. Assignment UI already wired to dynamic roles; verify edge cases.  
5. Admin preview “as role.”  
6. Clone / import / export updates + regression tests on config snapshots.  
7. Audit events and spec revision date bump when shipped; move items from **What Is Built** and trim **Next build** accordingly.

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
| Runtime fallback | malformed rows degrade to safe full-width rendering rather than crashing |

### Reviewer-specific notes

- Published reviewer configs resolve from the effective published snapshot first.
- When a snapshot includes `layout_json`, that layout is the canonical source for section ordering and row placement.
- Blind review can hide fields from the rendered form, but hidden fields should not invalidate the saved layout.

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

Migration placeholder: `008_smartsheet_attachment_sync.sql` unless another migration ships first.

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

## Remaining: Scholarship (program) rename

Ship the spec in **Naming: scholarships and cycles (admin)**. All open questions are resolved (slug is immutable; acceptance criteria are defined). Build the `PATCH /api/admin/programs/[programId]` route, inline-edit UI on the program detail page, and audit logging.

---

## Remaining: UX and Accessibility Polish

- mobile reviewer usability
- builder discoverability and empty states
- large-export user feedback
- admin recovery/error messaging around file-heavy workflows
- keyboard accessibility polish for the row-layout canvas

# Intake Form Tool — Build Spec

## Purpose

Replace Gravity Forms / WordPress as the nomination intake mechanism for graduate scholarship programs. Program coordinators (staff, not students) submit one form per nominated student. Each submission creates a row in an existing Smartsheet. The reviewer workflow (already built) picks up from there — reviewers log in, score nominees, and write scores back to Smartsheet.

This is a self-contained addition to the existing platform. No changes are required to the reviewer workflow, scoring, or Smartsheet writeback.

---

## Corrected Mental Model

```
Admin creates Smartsheet → enters Sheet ID → syncs columns
           ↓
Admin builds intake form (maps form fields → Smartsheet columns)
           ↓
Admin publishes form → shareable URL generated
           ↓
Program coordinator fills out form once per nominated student
   (no login required; optionally gated to @wsu.edu email domain)
           ↓
Submission → new row created in Smartsheet
   - Text/select/checkbox fields → cell values
   - File uploads → Vercel Blob → URL attachments on the row
           ↓
Admin assigns reviewers to cycle (already built)
           ↓
Reviewers log in, rate nominees (already built)
           ↓
Scores write back to Smartsheet (already built)
```

**Who submits:** Program staff / coordinators. Not students. Not reviewers. No account needed.

**Who manages the form:** Admins (platform admin or scholarship admin for the program).

**Where the data lives:** Smartsheet is the system of record. The app stores only the form schema and a lightweight submission audit log. No nominee PII is stored in the app database.

---

## Architecture Overview

### Existing infrastructure reused

| Existing piece | How it's reused |
|---|---|
| `connections` table + Smartsheet proxy | Same connection/token used to write rows |
| `sheet_schema_snapshot_json` on cycle | Column list reused to populate the field → column mapping picker |
| Sync Columns from Smartsheet | Must be done before building intake form (same prerequisite as review builder) |
| `scholarship_cycles` | Intake form is linked to a cycle (one form per cycle) |
| Audit logging | Submission events logged to `audit_logs` |

### New dependencies

| Dependency | Purpose | Notes |
|---|---|---|
| `@vercel/blob` | Client-side file upload bypassing 4.5 MB Vercel function body limit | Already available in Vercel project under Storage |
| Resend (or SendGrid) | Optional confirmation email to submitter | New env var `RESEND_API_KEY`; feature can be skipped initially |

### New env vars

```
BLOB_READ_WRITE_TOKEN   # Vercel Blob token — from Vercel Storage dashboard
RESEND_API_KEY          # Optional — for confirmation emails
```

---

## Data Model

### New tables (Migration 005)

#### `intake_forms`

One row per cycle. Stores form settings and publish state.

```sql
CREATE TABLE IF NOT EXISTS intake_forms (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                  UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  title                     VARCHAR(255) NOT NULL,
  description               TEXT,                          -- Instructions shown above the form
  is_published              BOOLEAN NOT NULL DEFAULT false,
  allow_submissions_from    TIMESTAMPTZ,                   -- NULL = open immediately on publish
  allow_submissions_until   TIMESTAMPTZ,                   -- NULL = no deadline
  require_wsu_email         BOOLEAN NOT NULL DEFAULT true, -- Gate to configured email domain
  submitter_email_column_id BIGINT,                        -- Optional: write submitter email to this Smartsheet column
  send_confirmation_email   BOOLEAN NOT NULL DEFAULT false,
  confirmation_message      TEXT,                          -- Shown on confirmation page
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_id)                                         -- One form per cycle
);

CREATE INDEX idx_intake_forms_cycle ON intake_forms(cycle_id);
```

#### `intake_form_fields`

One row per field in the form. Ordered by `sort_order`.

```sql
CREATE TABLE IF NOT EXISTS intake_form_fields (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id              UUID NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
  field_key            VARCHAR(100) NOT NULL,     -- Slug, auto-generated from label, used internally
  field_type           VARCHAR(50) NOT NULL
                         CHECK (field_type IN (
                           'short_text', 'long_text', 'email', 'number',
                           'dropdown', 'checkbox_group',
                           'file_upload',
                           'section_heading', 'description_text'
                         )),
  label                VARCHAR(255) NOT NULL,
  description          TEXT,                      -- Helper text rendered below the input
  required             BOOLEAN NOT NULL DEFAULT false,
  sort_order           INT NOT NULL DEFAULT 0,
  target_column_id     BIGINT,                    -- Smartsheet column ID to write value to
                                                  -- NULL for section_heading / description_text
  target_column_title  VARCHAR(255),              -- Denormalized for display in builder
  settings_json        JSONB NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(form_id, field_key)
);

CREATE INDEX idx_intake_form_fields_form ON intake_form_fields(form_id);
```

**`settings_json` schema by field type:**

| `field_type` | `settings_json` keys |
|---|---|
| `short_text` | `{ "maxLength": number \| null }` |
| `long_text` | `{ "maxWords": number \| null, "rows": number }` (rows default 6) |
| `email` | `{}` |
| `number` | `{ "min": number \| null, "max": number \| null, "step": number \| null }` |
| `dropdown` | `{ "options": string[] }` — static list; or `{ "useColumnOptions": true }` to pull PICKLIST options from Smartsheet column |
| `checkbox_group` | `{ "options": string[], "minChecked": number \| null }` — stored to Smartsheet as comma-separated string |
| `file_upload` | `{ "maxSizeMb": number, "acceptedTypes": string[] }` — e.g. `["application/pdf"]` |
| `section_heading` | `{}` — display only, no column mapping |
| `description_text` | `{ "content": string }` — display only, markdown supported |

#### `intake_submissions`

Audit record only. Nominee data is in Smartsheet, not here.

```sql
CREATE TABLE IF NOT EXISTS intake_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id           UUID NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
  cycle_id          UUID NOT NULL REFERENCES scholarship_cycles(id) ON DELETE CASCADE,
  smartsheet_row_id BIGINT,            -- Row ID returned by Smartsheet addRow (null if failed before row created)
  submitter_email   VARCHAR(255),      -- Email entered on form (may be null if not required)
  status            VARCHAR(20) NOT NULL DEFAULT 'submitted'
                      CHECK (status IN ('submitted', 'failed')),
  error_detail      TEXT,              -- Populated if status = 'failed'
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_intake_submissions_form ON intake_submissions(form_id);
CREATE INDEX idx_intake_submissions_cycle ON intake_submissions(cycle_id);
CREATE INDEX idx_intake_submissions_submitted ON intake_submissions(submitted_at);
```

### No draft table

Program coordinators fill out the form in one sitting. Draft-and-return is not in scope for this phase.

---

## Field Types — Full Spec

### `short_text`
Single-line text input (`<input type="text">`). Optional character limit (`maxLength`). Maps to a Smartsheet TEXT_NUMBER column. Example uses: Student first name, last name, Student ID, Department name.

### `long_text`
Multi-line textarea. Optional word count limit enforced client-side (live counter) and server-side (reject if over). Default 6 rows, configurable. Maps to a Smartsheet TEXT_NUMBER column. Example uses: Research proposal, dissertation prospectus, schedule of milestones. **This is the primary replacement for file uploads of typed documents.**

### `email`
Single-line email input (`<input type="email">`). Domain validation applied if `require_wsu_email` is on. Maps to TEXT_NUMBER column.

### `number`
Numeric input with optional min/max/step. Maps to TEXT_NUMBER column (Smartsheet stores all user data as text internally anyway).

### `dropdown`
Single select (`<select>`). Options either hardcoded in `settings_json.options` or pulled from a Smartsheet PICKLIST column's options at form-load time (`useColumnOptions: true`). Stored as the selected string value. Maps to TEXT_NUMBER or PICKLIST column.

### `checkbox_group`
Set of checkboxes. Multiple can be checked. Stored as a comma-separated string (e.g. `"Proposal approved, Advanced to candidacy"`). Maps to TEXT_NUMBER column. Example use: Eligibility checklist.

### `file_upload`
File picker (`<input type="file">`). Upload goes client → Vercel Blob directly (bypasses Vercel function body limit). Resulting blob URL is sent to the submission API, then attached to the Smartsheet row as a URL attachment. Does **not** map to a Smartsheet column — stored as a row attachment. Configurable `maxSizeMb` (default 25, max 500) and `acceptedTypes` (default `["application/pdf"]`).

### `section_heading`
Visual divider with a label. Renders as an `<h2>` or `<h3>`. No data collected. No column mapping.

### `description_text`
Free text / instructions block. Renders as formatted text above the next field. No data collected. Supports basic markdown (bold, italic, lists, links).

---

## Smartsheet Integration — New Functions

Add to `src/lib/smartsheet.ts`:

### `addRow(connectionId, sheetId, cells)`

Creates a new row in a sheet.

```
POST https://api.smartsheet.com/2.0/sheets/{sheetId}/rows
Authorization: Bearer {decryptedToken}
Content-Type: application/json

{
  "cells": [
    { "columnId": 1234567890, "value": "Smith" },
    { "columnId": 1234567891, "value": "John" },
    { "columnId": 1234567892, "value": "Graduate School" }
  ]
}
```

Returns the created row's numeric ID (`result[0].id`). This row ID is stored in `intake_submissions.smartsheet_row_id` and is used to attach files.

**Error handling:** Same pattern as existing `updateRowCells` — parse `{ httpStatus, errorCode, message }`, pass 429 rate-limit through, throw structured error otherwise.

### `attachUrlToRow(connectionId, sheetId, rowId, name, url)`

Attaches a URL (Vercel Blob URL) to an existing row. Reviewers see these as clickable links in the Smartsheet Attachments panel and in the existing review platform's attachment section.

```
POST https://api.smartsheet.com/2.0/sheets/{sheetId}/rows/{rowId}/attachments
Authorization: Bearer {decryptedToken}
Content-Type: application/json

{
  "name": "curriculum_vita.pdf",
  "description": "Uploaded via WSU Graduate School Scholarship Review",
  "attachmentType": "LINK",
  "url": "https://abc123.public.blob.vercel-storage.com/..."
}
```

Call once per uploaded file after `addRow` succeeds. If an attachment call fails, log the error but do not roll back the row — the submission is still valid. Log the failure to `intake_submissions.error_detail`.

---

## API Routes

### Admin routes (authenticated, require cycle manage permission)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/admin/cycles/[cycleId]/intake-form` | Get form schema + fields for builder |
| `POST` | `/api/admin/cycles/[cycleId]/intake-form` | Create form for cycle (idempotent — returns existing if already created) |
| `PATCH` | `/api/admin/cycles/[cycleId]/intake-form` | Update form settings (title, description, dates, email gate, confirmation message) |
| `PUT` | `/api/admin/cycles/[cycleId]/intake-form/fields` | Replace all fields (bulk save, same pattern as FieldMappingBuilder save) |
| `POST` | `/api/admin/cycles/[cycleId]/intake-form/publish` | Set `is_published = true` |
| `POST` | `/api/admin/cycles/[cycleId]/intake-form/unpublish` | Set `is_published = false` |
| `GET` | `/api/admin/cycles/[cycleId]/intake-form/submissions` | List submission audit records (submitter email, timestamp, status, Smartsheet row ID) |

### Public submission routes (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/submit/[cycleId]` | Return published form schema. 404 if not published or outside window. |
| `POST` | `/api/submit/[cycleId]` | Accept submission: validate → `addRow` → `attachUrlToRow` × N → write audit record. |

**Public route security:**
- Form must be published (`is_published = true`)
- Submission must be within `allow_submissions_from` / `allow_submissions_until` window if set
- If `require_wsu_email = true`, validate submitter email domain against `ALLOWED_REVIEWER_EMAIL_DOMAIN` (same env var already used for reviewer assignments)
- Server-side validation of all required fields before writing to Smartsheet
- Rate limiting: 20 submissions per IP per hour per cycle (simple in-memory counter using Next.js middleware, or header-based via Vercel)
- No auth token or session required

### File upload route

Vercel Blob supports client-side uploads directly from the browser using a server-issued token. The browser calls the Blob API directly — the file never passes through a Vercel function.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/submit/[cycleId]/upload-token` | Issues a Vercel Blob client upload token. Validates cycle is published and within window. Returns token for client to use with `@vercel/blob`'s `upload()`. |

The client receives the token, uploads the file directly to Vercel Blob, then passes the returned URL in the main form POST body under `_attachments: [{ fieldKey, blobUrl, fileName, sizeBytes }]`.

---

## Pages

### Admin: Intake Form Builder

**Route:** `/admin/scholarships/[id]/cycles/[cycleId]/intake-form`

A dedicated sub-page for the form builder (same pattern as `/builder` for the reviewer field mapper). Accessible via a "Build intake form" link on the cycle detail page.

**Sections:**

1. **Form settings** — title, description/instructions, open date, close date, email domain gate toggle, confirmation message, send confirmation email toggle

2. **Fields** — drag-to-reorder list of fields. Add field button opens a picker for field type. Each field card shows:
   - Field type badge
   - Label (editable inline)
   - Helper text (editable inline, optional)
   - Required toggle
   - Column mapping picker (dropdown of columns from `sheet_schema_snapshot_json` — same source as review builder)
   - Type-specific settings (word limit for long_text, options for dropdown/checkbox, max size for file_upload)
   - Delete button

3. **Preview** — live preview of the form as it will appear to submitters, updated as fields are edited

4. **Save / Publish controls** — Save (drafts the form), Publish (makes it live, generates URL), Unpublish button (if published), copy-to-clipboard for the public URL

**Column mapping constraint:** Fields of type `section_heading` and `description_text` have no column picker. `file_upload` fields have no column picker (they become row attachments). All other field types require a column mapping before the form can be published.

**Publish validation:** Before publishing, check:
- At least one data field exists (not just headings)
- All required-to-map fields have a `target_column_id`
- Cycle has a connected Smartsheet with synced schema (same check as review builder)

### Public: Submission Page

**Route:** `/submit/[cycleId]`

No auth. No app header/footer — standalone branded page.

**Layout:**
- WSU logo + scholarship name as header
- Cycle label as subtitle
- Form description/instructions block (if set)
- Fields rendered in `sort_order`
- Section headings render as visual dividers
- Live word count on `long_text` fields with a limit
- File picker with drag-and-drop zone for `file_upload` fields; file name + size shown after selection; upload to Blob happens on file select (not on submit) so the user sees upload progress before hitting Submit
- Required field indicator (asterisk)
- Submit button
- Error summary block at top on failed validation

**States:**
- **Not published / outside window:** Static page with message "This form is not currently accepting submissions."
- **Loading:** Skeleton while form schema is fetched client-side
- **Filling out:** Normal form state
- **Uploading files:** Progress indicator per file during Blob upload
- **Submitting:** Button disabled, "Submitting…" text
- **Error:** Error summary block with field-level messages
- **Success:** Redirect to `/submit/[cycleId]/confirmation`

### Public: Confirmation Page

**Route:** `/submit/[cycleId]/confirmation`

Static branded page. Shows:
- "Nomination submitted successfully"
- Confirmation message set by admin (if any)
- Timestamp
- "Submit another nomination" link (back to form)

---

## Submission Flow — Step by Step

```
1. Browser loads /submit/[cycleId]
      → GET /api/submit/[cycleId]
      → Server: checks published + window → returns form schema

2. User fills out form

3. User selects a file (file_upload field)
      → POST /api/submit/[cycleId]/upload-token (gets Blob token)
      → Browser: uploads file directly to Vercel Blob
      → Blob returns { url, pathname, size }
      → UI shows "✓ curriculum_vita.pdf (342 KB)"

4. User clicks Submit
      → Client validates: required fields present, word counts within limit, all files uploaded

5. POST /api/submit/[cycleId]
   Body: {
     submitterEmail: "gcrouch@wsu.edu",
     fields: {
       "student_first": "Jane",
       "student_last": "Smith",
       "student_id": "12345678",
       "department": "Political Science",
       "research_proposal": "This research examines...",
       "eligibility": "Proposal approved, Advanced to candidacy"
     },
     attachments: [
       { fieldKey: "cv_upload", blobUrl: "https://...", fileName: "cv.pdf", sizeBytes: 350000 },
       { fieldKey: "transcript", blobUrl: "https://...", fileName: "transcript.pdf", sizeBytes: 180000 }
     ]
   }

6. Server validates:
      - Form published + within window
      - WSU email domain (if required)
      - All required fields present
      - Word counts within limits
      - Field values match expected types
      → 400 with field-level errors if invalid

7. Server: addRow(connectionId, sheetId, cells)
      → cells built by iterating fields, mapping fieldKey → target_column_id → value
      → if submitter_email_column_id is set, include that cell too
      → Smartsheet returns new rowId

8. Server: for each attachment in order
      attachUrlToRow(connectionId, sheetId, rowId, fileName, blobUrl)
      → failures logged but do not abort

9. Server: INSERT INTO intake_submissions (form_id, cycle_id, smartsheet_row_id, submitter_email, status)

10. Server: logAudit({ action_type: 'intake_submission', cycle_id, metadata: { rowId, submitterEmail } })

11. Server: if send_confirmation_email = true → send via Resend (non-blocking, best-effort)

12. Server: return { success: true }

13. Browser: redirect to /submit/[cycleId]/confirmation
```

---

## Admin Cycle Page Changes

### New section on cycle detail page

Below "Smartsheet connection", above "Fields & layout (what reviewers see)":

```
Nomination intake form
──────────────────────
[Build intake form →]   [Preview form]   Status: Draft / Published (since Jan 15, 2026)

If published:
Public URL: https://yourapp.vercel.app/submit/{cycleId}  [Copy]
Submissions: 12 received
```

### Setup checklist — updated

```
1. ✓ Connect a Smartsheet
2. ✓ Import schema (sync columns)
3. ○ Build intake form (optional — skip if using external intake)
4. ○ Configure fields & layout (what reviewers see)
5. ○ Publish configuration
6. ○ Assign reviewers
7. ○ Activate cycle
```

Step 3 is marked optional. Cycles using Gravity Forms or manual Smartsheet entry can skip it.

---

## Reviewer Experience — No Changes Required

Once a row exists in Smartsheet (however it got there — intake form, Gravity Forms, manual entry, CSV import), it appears as a nominee in the existing review interface.

Long-text field values from the intake form (proposal, prospectus, etc.) appear as `metadata` display fields — readable inline without opening attachments.

File attachments (CV, transcript, letters) appear in the existing "Attachments" section of the reviewer scoring form. Reviewers click to open the PDF from Vercel Blob.

---

## Gravity Forms Field-to-Type Mapping

Based on the example forms:

| Gravity Forms field | Intake form field type | Notes |
|---|---|---|
| Student Name (First/Last) | `short_text` × 2 | Separate fields or can combine into one |
| Email | `email` | |
| Student ID | `short_text` | maxLength: 9 |
| Department | `short_text` | |
| Department Contact / Chair | `short_text` | |
| Chair Email | `email` | |
| Eligibility checkboxes | `checkbox_group` | options match eligibility items |
| Letters of Recommendation | `file_upload` | Keep as file — third-party document |
| CV / Curriculum Vita | `file_upload` | Keep as file — formatted document |
| Unofficial Transcript | `file_upload` | Keep as file — official document |
| Letter of Support / Advisor | `file_upload` | Keep as file — third-party letter |
| Research/Scholarship Proposal | `long_text` | Convert from file to text |
| Dissertation Prospectus (1000 words) | `long_text` | maxWords: 1000 |
| 9-month schedule / benchmarks | `long_text` | Convert from file to text |

---

## Security Model

| Concern | Mitigation |
|---|---|
| PII in submissions | Data written to Smartsheet (existing institutional system of record). App DB stores only submitter email + Smartsheet row ID. |
| Unauthorized form submissions | WSU email domain gate (default on). Rate limiting: 20 submissions/IP/hour. |
| File access control | Vercel Blob URLs are unguessable (UUID path). URLs are stored as Smartsheet row attachments, accessible to anyone with the Smartsheet link or via the review platform (same access control as other nominee data). |
| Token exposure | Smartsheet API token remains server-side only, same as existing proxy pattern. Public routes never see or return the token. |
| Admin-only form management | All `/api/admin/cycles/[cycleId]/intake-form/*` routes require `canManageCycle` permission check — same auth as existing cycle routes. |
| Spam / abuse | Rate limiting + WSU email domain gate is sufficient for internal academic use. CAPTCHA not needed unless the form URL becomes truly public. |

---

## Email Confirmation (Optional)

If `send_confirmation_email = true` on the form:

```
To: submitter email
Subject: Nomination received — {scholarship name} ({cycle label})
Body:
  Thank you for submitting a nomination for {scholarship name}.

  Nominee: {student first} {student last}
  Submitted: {timestamp}

  {confirmation_message from admin, if set}

  This is an automated message from the WSU Graduate School Scholarship Review platform.
```

Implementation: `src/lib/email.ts` — thin wrapper over Resend's `POST /emails` API. Called after successful Smartsheet write, non-blocking (fire-and-forget with error logging). Enabled only if `RESEND_API_KEY` is set in env.

---

## Implementation Order

### Phase 1 — Text fields only, no file uploads

Get nominations flowing into Smartsheet without files. Proves the end-to-end loop.

1. Migration 005 (`intake_forms`, `intake_form_fields`, `intake_submissions`)
2. `addRow()` in `src/lib/smartsheet.ts`
3. Admin API routes (CRUD form + fields, publish/unpublish)
4. Intake form builder UI (`/admin/.../intake-form`)
   - Form settings panel
   - Field list with drag-to-reorder
   - Column mapping picker
   - Save + Publish controls
5. Public submission page (`/submit/[cycleId]`)
   - Renders short_text, long_text, email, number, dropdown, checkbox_group, section_heading, description_text
   - Validation + error display
   - Submit → `addRow`
   - Confirmation page
6. Cycle detail page — add intake form section + update setup checklist

### Phase 2 — File uploads

7. Add `@vercel/blob` dependency
8. Upload token route (`/api/submit/[cycleId]/upload-token`)
9. `attachUrlToRow()` in `src/lib/smartsheet.ts`
10. `file_upload` field type in form builder (max size, accepted types config)
11. File picker UI on public form (drag-drop, upload-on-select, progress)
12. Submission API updated to handle `attachments` array

### Phase 3 — Polish

13. Confirmation email via Resend (if `RESEND_API_KEY` is set)
14. Submission log in admin UI (list of submissions per cycle with status)
15. Form preview in admin builder
16. Open/close date enforcement + UI indicators on public form

---

## Open Questions

| # | Question | Default assumption |
|---|---|---|
| 1 | Should program coordinators be able to edit a submission after submitting? | No. If a mistake is made, admin deletes the Smartsheet row and coordinator resubmits. |
| 2 | Should there be a submission notification email to the admin when a new nomination comes in? | Out of scope for now. Admin monitors Smartsheet directly. |
| 3 | Should the public form URL include a slug or just the cycleId UUID? | UUID is sufficient. A slug adds complexity without clear benefit. |
| 4 | Should duplicate submissions (same submitter email + same cycle) be blocked? | No — programs may legitimately submit multiple nominees. Deduplication is Smartsheet's responsibility. |
| 5 | Should the form support conditional fields (show field B only if field A = X)? | No. Current Gravity Forms usage has no conditional logic. Can be added later. |
| 6 | File storage: should Vercel Blob files be cleaned up if the Smartsheet row is deleted? | No automated cleanup. Files are small relative to Blob storage limits; manual cleanup if needed. |
| 7 | Word limit on `long_text` — hard block or soft warning? | Hard block (server rejects if over). Show live counter; turn red at 90% of limit. |
| 8 | Should the intake form be clonable via the existing template/clone system? | Yes, eventually. Form schema should be included in export-config / clone-config. Phase 3 item. |

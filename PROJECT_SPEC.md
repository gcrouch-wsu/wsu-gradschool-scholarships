# Project Specification: Scholarship Review Platform

**Local-only - do not commit.** For setup and deployment, use `README.md` and `instruction.md`.

---

## Project Goal

Admin-managed workflow layer on top of Smartsheet for scholarship-style review cycles. Staff connect sheets, configure public intake and reviewer-facing forms, assign reviewers, and reviewers read, score, comment, and attach supporting files through the app.

Smartsheet remains the source of truth for structured nominee row data. Postgres stores app-owned state such as users, sessions, assignments, builder state, published snapshots, progress, audit logs, and file metadata.

This is the **Workflow** platform family, distinct from `smartsheets_view` (Publishing/Display). The operating model is:

- read from Smartsheet
- authorize in the app
- write structured row data back to Smartsheet
- store app-owned workflow state in Postgres
- store uploaded files in private Blob unless a future native-attachment build changes that
- reconcile schema drift explicitly

---

## What Is Built (Current Baseline)

- Admin dashboard for programs, cycles, connections, users, reviewer assignments, and templates
- Two-tier admin model: platform admin vs program admin
- Cycle setup: Smartsheet connection selection, sheet sync, reviewer-role controls, blind-review settings, and external reviewer options
- Reviewer builder: role-aware field behavior, explicit hide-in-blind-review controls, row-based layout, publish/unpublish workflow, version snapshots, import/export/clone support, and delete/reset flow
- Public intake builder: draft/publish/unpublish, versioned snapshots, rich-text instructions, multi-file PDF uploads, delete guard, and row-based desktop layout
- Public submit workflow: direct Blob uploads, metadata-only submit route, Smartsheet row creation, submission idempotency, schema-drift detection, rate limiting, and honeypot abuse control
- Reviewer workflow: direct routing into the applicant page, progress tracking, Save and Next, merged attachment view, and reviewer-uploaded attachments
- Admin preview and export tools: preview config, attachment merging, and ZIP export of intake attachments
- Audit logging, encrypted Smartsheet credentials, DB-backed sessions, and private file access through app-controlled routes

---

## Technical Architecture

- **Framework**: Next.js App Router on Vercel
- **Current build command**: `vercel.json` runs `npm run build`
- **Current package build script**: `next build`
- **Bundler note**: On Next.js 16, plain `next build` uses Turbopack by default. That is the current contract for this repo.
- **Webpack note**: `--webpack` is not part of this repo's build spec. Only add it if a reproduced production-build regression justifies it, and update both `package.json` and `vercel.json` together.
- **Styling**: Tailwind CSS v4
- **Auth**: Custom DB-backed sessions with bcrypt
- **Storage**: PostgreSQL for app-owned state; Smartsheet for nominee/source rows; Vercel Blob for private uploaded files
- **Encryption**: AES-256-GCM for Smartsheet credentials via `ENCRYPTION_KEY`
- **Runtime**: App Router route handlers default to Node.js. Many DB/crypto/token routes also export `runtime = "nodejs"` explicitly as a guardrail.

### Build and runtime guardrails

- Use `npm run build` as the source of truth for what Vercel executes.
- Routes that import `pg`, decrypt Smartsheet credentials, use Node `crypto`, generate Blob upload tokens, stream ZIP exports, or issue signed file URLs must stay on the Node.js runtime.
- If any route is later moved to Edge or split across runtimes, add `export const runtime = "nodejs"` to every DB/crypto/token route as a hard guardrail.

### Local verification before pushing

- Run `npm run build`
- Run `npx tsc --noEmit` when touching shared types, route contracts, or layout persistence
- Run `npm test` when changing auth, file handling, layout logic, or Smartsheet read/write paths

### Canonical build docs

- The intake-form contract lives in `forms.md`.
- The shared future direction for intake/reviewer layout builders lives in `layout-builder-spec.md`.
- The implementation-ready layout contract lives in `layout-builder-blueprint.md`.
- The future native Smartsheet file-mirroring contract lives in `smartsheet-native-attachments.md`.

---

## Database Schema

Migrations live in `supabase/migrations/`.

| Migration | Key tables / changes |
|-----------|----------------------|
| `001_initial_schema.sql` | `users`, `sessions`, `scholarship_programs`, `connections`, `scholarship_cycles`, `roles`, `scholarship_memberships`, `field_configs`, `field_permissions`, `view_configs`, `config_versions`, `audit_logs`, `user_cycle_progress`, `app_config` |
| `002_program_admins.sql` | `program_admins` |
| `003_scholarship_templates.sql` | `scholarship_templates` |
| `004_program_connections.sql` | program-scoped Smartsheet connections |
| `005_intake_forms.sql` | `intake_forms`, `intake_form_fields`, `intake_form_versions`, `intake_submissions`, `intake_submission_files`, `intake_rate_limit_events` |
| `006_reviewer_row_files.sql` | `reviewer_row_files` for reviewer-uploaded attachments |
| `007_layout_json.sql` | `layout_json` persistence on `intake_forms` and `view_configs` for row-based layouts |

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `ENCRYPTION_KEY` | Yes | Encryption/signing key for Smartsheet tokens, IP hashing, and file URL signatures |
| `NEXT_PUBLIC_APP_URL` | Yes for production | Public app base URL used for live-form links and signed file routes |
| `BLOB_READ_WRITE_TOKEN` | Yes when file features are enabled | Required for intake uploads, reviewer uploads, cleanup jobs, signed file access, and ZIP export |
| `CRON_SECRET` | Yes when protected cron routes are enabled | Protects cleanup and background job routes |
| `ALLOWED_REVIEWER_EMAIL_DOMAIN` | No | Default reviewer-assignment domain restriction; typically `wsu.edu` |
| `SEED_ADMIN_EMAIL` | No | Local bootstrap admin email for `npm run db:seed` |
| `SEED_ADMIN_PASSWORD` | Local bootstrap only | Password for the initial seeded admin |

---

## Smartsheet API: Key Rules

These rules are shared with `smartsheets_view`, but this repo only implements the subset needed for workflow and intake.

- **Never send `value: null`**. Use `""` to clear.
- **Column type normalization** should continue to use `column.type ?? column.columnType ?? "TEXT_NUMBER"`.
- **Structured error handling** matters. Smartsheet helpers should surface `httpStatus` and `errorCode`, especially for `429` / `4003` rate limiting.
- **PICKLIST** writes default to `strict: true`.
- **CONTACT_LIST / MULTI_CONTACT_LIST** are out of scope for the current public intake builder. Current write logic is oriented around simple `value` cells.
- **MULTI_CONTACT_LIST** requires `objectValue: { objectType: "MULTI_CONTACT", values: [...] }` with `values` plural if support is ever added later.
- **Clearing MULTI_CONTACT_LIST** must use `{ "value": "" }`. Sending `values: []` causes Smartsheet error `1012`.
- **Smartsheet LINK attachments are not used** in the current intake system.
- The recommended future direction for attachment mirroring is **native Smartsheet `FILE` attachments**, not LINK attachments. See `smartsheet-native-attachments.md`.

---

## Fixes Applied

These are implemented and should be treated as current platform behavior, not future work.

### 1. Serverless DB pool guardrails

`src/lib/db.ts` uses a small pool appropriate for Vercel/Supabase serverless usage.

### 2. Smartsheet null coercion and structured writes

`src/lib/smartsheet.ts` coerces `null -> ""`, applies current picklist rules, and avoids unsupported contact-object writes in the intake path.

### 3. Structured Smartsheet error parsing

`src/lib/smartsheet.ts` parses JSON error bodies and surfaces `httpStatus` and `errorCode`.

### 4. Rate-limit passthrough on write paths

Reviewer and intake-related routes preserve meaningful `429` behavior instead of collapsing all Smartsheet failures into generic `500` responses.

### 5. Intake submission idempotency and schema-drift handling

Public intake submission uses `submission_id`-based recovery, blocks duplicate row creation, and auto-unpublishes invalid intake configs when live Smartsheet schema drift is detected.

### 6. Private file storage and app-controlled access

Intake uploads and reviewer uploads use private Blob storage and are exposed through app-generated signed routes instead of public raw Blob URLs.

### 7. Attachment export hardening

Bulk attachment export now streams ZIP downloads from private Blob, sanitizes ZIP entry naming, and avoids the earlier buffered-response failure mode on Vercel.

### 8. Row-based layout persistence

Intake and reviewer layouts now persist canonical `layout_json` instead of relying only on loose per-field lane flags.

---

## Remaining Tasks

These are the real remaining areas, not already-shipped features.

### 1. Native Smartsheet file mirroring

The current shipped model keeps files in private Blob and surfaces them through app APIs. The future per-field "push to Smartsheet" build remains separate work and is defined in `smartsheet-native-attachments.md`.

Important note: that spec should be reconciled against the current intake schema before implementation so the future toggle lands on intake-field storage, not reviewer-config storage.

### 2. Broader regression coverage

The platform has targeted tests around intake, layout, and Smartsheet helpers, but broader coverage is still worth adding for:

- attachment export end-to-end behavior
- reviewer upload flows
- layout-builder save/publish edge cases
- intake publish/save/delete paths
- admin reset/delete safety flows

### 3. UX and accessibility polish

The major workflows work, but there is still room for iterative polish in:

- mobile reviewer usability
- builder discoverability and empty states
- large-export user feedback
- admin recovery/error messaging around file-heavy workflows

---

## Working Rules

1. When a fix is implemented, move it from "Remaining Tasks" to "Fixes Applied".
2. Any change to Smartsheet write helpers must be evaluated against the rules above, especially null handling, picklist strictness, and structured contact object shapes.
3. Watch for Unicode smart quotes or pasted non-ASCII punctuation in JSX after AI/editor edits. If the build fails with an unexpected-character error, normalize the quotes to ASCII or use HTML entities in text nodes.
4. Production builds run TypeScript. Use `npx tsc --noEmit` as a fast local precheck, but treat `npm run build` as the final local verifier.
5. This repo's current build spec is plain `next build`. Do not add `--webpack` unless a real build regression is reproduced and documented.

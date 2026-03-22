# Project Specification: Scholarship Review Platform

**Local-only - do not commit.** For setup and deployment see `README.md` and `instruction.md`.

---

## Project Goal

Admin-managed workflow layer on top of Smartsheet for scholarship-style review cycles. Staff connect sheets, configure display and scoring behavior, assign reviewers, and reviewers read, score, and comment through a purpose-built interface.

Smartsheet remains the source of truth for nominee row data. Postgres stores app-owned state such as users, sessions, assignments, configuration, progress, and audit logs.

This is the **Workflow** platform family, distinct from `smartsheets_view` (Publishing/Display). The operating model is:

- read from Smartsheet
- authorize in the app
- write back to Smartsheet
- audit in Postgres
- reconcile drift explicitly

---

## What Is Built (Current Baseline)

- Admin dashboard: programs, cycles, connections, users
- Two-tier admin model: platform admin vs scholarship admin
- Cycle configuration: Smartsheet connection, field mapping builder, role permissions, blind review toggle, external reviewers toggle
- Config versioning: draft snapshots, publish/unpublish workflow, schema drift detection
- Template system: save/apply presets across cycles, export/import config as JSON
- Reviewer workflow: assigned cycle list, nominee list, score/comment form, Save & Next, resume-where-left-off
- Audit logging: admin actions plus reviewer before/after cell writes where practical
- Session management: DB-backed sessions with idle timeout and forced password change flow
- Security: encrypted Smartsheet tokens, httpOnly cookies, server-side permission enforcement

---

## Technical Architecture

- **Framework**: Next.js App Router on Vercel
- **Current build command**: `vercel.json` runs `npm run build`
- **Current package build script**: `next build`
- **Bundler note**: On Next.js 16, plain `next build` uses Turbopack by default. That is the current contract for this repo.
- **Webpack note**: `--webpack` is not currently part of this repo's build spec. Only add it if a reproduced production-build regression justifies it, and update both `package.json` and `vercel.json` together.
- **Styling**: Tailwind CSS v4
- **Auth**: Custom DB-backed sessions with bcrypt
- **Storage**: PostgreSQL for app-owned state; Smartsheet for nominee/source rows
- **Encryption**: AES-256-GCM for Smartsheet credentials via `ENCRYPTION_KEY`
- **Runtime**: App Router route handlers default to Node.js. This repo currently relies on that default and does not use Edge runtime.

### Build and runtime guardrails

- Use `npm run build` as the source of truth for what Vercel will execute.
- Route handlers that import `pg`, decrypt Smartsheet credentials, use Node `crypto`, or mint upload/storage tokens must stay on the Node.js runtime.
- In this repo, explicit `export const runtime = "nodejs"` is optional today because the default runtime is already Node.js.
- If any route is later moved to Edge or split across runtimes, add `export const runtime = "nodejs"` to every DB/crypto/token route as a hard guardrail.

### Local verification before pushing

- Run `npm run build`
- Run `npx tsc --noEmit` when touching shared types or route contracts
- Run `npm test` when changing auth, write paths, or Smartsheet serialization

### Intake-form build spec

The canonical intake-form build document now lives in `forms.md`.
The shared future direction for intake/reviewer layout builders lives in `layout-builder-spec.md`.
The implementation-ready blueprint for that refactor lives in `layout-builder-blueprint.md`.

---

## Database Schema

Migrations live in `supabase/migrations/`.

| Migration | Key tables |
|-----------|-----------|
| `001_initial_schema.sql` | users, sessions, scholarship_programs, connections, scholarship_cycles, roles, scholarship_memberships, field_configs, field_permissions, view_configs, config_versions, audit_logs, user_cycle_progress, app_config |
| `002_program_admins.sql` | program_admins |
| `003_scholarship_templates.sql` | scholarship_templates |
| `004_program_connections.sql` | program-scoped Smartsheet connections |

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for Smartsheet tokens |
| `ALLOWED_REVIEWER_EMAIL_DOMAIN` | No | Default `wsu.edu`; enforced on WSU-only reviewer assignment flows |

---

## Smartsheet API: Key Rules

These rules are shared with `smartsheets_view`, but this repo only implements a subset today.

- **Never send `value: null`**. Use `""` to clear.
- **Column type normalization** should continue to use `column.type ?? column.columnType ?? "TEXT_NUMBER"`.
- **Structured error handling** matters. Smartsheet write helpers should surface `httpStatus` and `errorCode`, especially for 429 / 4003 rate limiting.
- **PICKLIST** defaults to `strict: true`. If a future intake/admin flow intentionally allows off-list values, the cell payload must include `strict: false`.
- **CONTACT_LIST / MULTI_CONTACT_LIST** are not fully implemented in this repo today. Current write logic is oriented around simple `value` cells.
- **MULTI_CONTACT_LIST** requires `objectValue: { objectType: "MULTI_CONTACT", values: [...] }` with `values` plural.
- **Clearing MULTI_CONTACT_LIST** must use `{ "value": "" }`. Sending `values: []` causes Smartsheet error 1012.
- **URL attachments are not file uploads**. If a future intake flow mirrors Blob files into Smartsheet as URL attachments, downstream APIs and UIs must handle LINK attachments explicitly. Do not assume file-style signed `attachment.url` values will exist.
- The recommended future direction is **native Smartsheet `FILE` attachment mirroring**, not LINK attachments. See [smartsheet-native-attachments.md](/C:/python%20projects/vercel/scholarship-review-platform/smartsheet-native-attachments.md).

---

## Fixes Applied

These were identified by cross-referencing this repo with `smartsheets_view` lessons and the current Vercel/Smartsheet behavior.

### 1. DB pool connection limit

`src/lib/db.ts` uses a small pool with:

- `max: 2`
- `idleTimeoutMillis: 10000`
- `connectionTimeoutMillis: 5000`

This is important for serverless Postgres usage on Vercel/Supabase.

### 2. Null-value guard in `updateRowCells`

`src/lib/smartsheet.ts` coerces `null -> ""` before PUT requests so Smartsheet does not reject explicit JSON nulls.

### 3. Structured Smartsheet error parsing

`src/lib/smartsheet.ts` parses JSON error bodies and surfaces `httpStatus` and `errorCode`.

### 4. 429 passthrough on reviewer saves

Reviewer save routes treat Smartsheet 429 / error code 4003 as rate limiting and return HTTP 429 to the client instead of a generic 500.

---

## Remaining Tasks

### 1. Smartsheet write-path tests

Highest-risk tests still worth adding:

- `updateRowCells` null coercion
- `updateRowCells` structured error parsing
- `updateRowCells` rate-limit handling
- reviewer POST route 429 passthrough
- reviewer POST route timeout/retriable behavior
- reviewer POST route filtering of non-editable columns

### 2. UX and accessibility polish

Still worth a dedicated pass before broad user rollout:

- loading states and save feedback
- inline validation and `role="alert"` errors
- empty states
- mobile reviewer usability
- heading hierarchy and metadata
- schema-drift prominence before publish
- audit-log filtering

### 3. Intake-form feature

Build and launch details for the intake feature are maintained only in `forms.md` so they do not drift across multiple docs.

---

## Working Rules

1. When a fix is applied, move it from "Remaining Tasks" to "Fixes Applied".
2. Any change to `updateRowCells` or other Smartsheet write helpers must be evaluated against the rules above, especially null handling, picklist strictness, and structured contact object shapes.
3. Watch for Unicode smart quotes or pasted non-ASCII punctuation in JSX after AI/editor edits. If the build fails with an unexpected-character error, normalize the quotes to ASCII or use HTML entities in text nodes.
4. Production builds run TypeScript. Use `npx tsc --noEmit` as a fast local precheck, but treat `npm run build` as the final local verifier.
5. This repo's current build spec is plain `next build`. Do not add `--webpack` unless a real build regression is reproduced and documented.

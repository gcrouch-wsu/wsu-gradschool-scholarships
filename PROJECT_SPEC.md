# Project Specification: Scholarship Review Platform

**Local-only — do not commit.** For setup and deployment see `README.md` and `instruction.md`.

---

## Project Goal

Admin-managed workflow layer on top of Smartsheet for scholarship-style review cycles. Staff connect sheets, configure display and scoring behavior, assign reviewers, and reviewers read, score, and comment through a purpose-built interface. Smartsheet remains the source of truth for nominee data; the app stores reviewer assignments, scores, comments, and audit logs in Postgres.

This is the **Workflow** platform family — distinct from `smartsheets_view` (Publishing/Display). The interaction model is: read → authorize → write → audit → reconcile.

---

## What Is Built (Current Baseline)

- Admin dashboard: programs, cycles, connections (encrypted tokens), users
- Two-tier admin model: platform admin (full access) vs scholarship admin (scoped to assigned programs)
- Cycle configuration: Smartsheet connection, field mapping builder (purpose, display type, role permissions), blind review toggle, external reviewers toggle
- Config versioning: published config snapshots; publish/unpublish workflow; schema drift detection
- Template system: save and apply config presets across cycles; export/import config as JSON
- Reviewer interface: assigned cycle list, nominee list, score/comment form, Save & Next, resume-where-left-off (DB-backed progress)
- Role-based field permissions: per-role view/edit flags; blind review suppresses identity/subtitle fields
- Audit logging: all admin and reviewer actions recorded with before/after cell values on saves
- Session management: DB-backed sessions (revocable), sliding idle timeout (default 120 min), session warning (10 min before expiry), must_change_password enforcement
- Security: AES-256-GCM encrypted Smartsheet tokens, httpOnly session cookies, server-side field permission enforcement

---

## Technical Architecture

- **Framework**: Next.js (App Router), deployed on Vercel
- **Build**: `next build` — no TipTap/ProseMirror, so `--webpack` flag is not required
- **Styling**: Tailwind CSS v4
- **Auth**: Custom DB-backed sessions; bcrypt password hashing; httpOnly cookies
- **Storage**: PostgreSQL — sessions, users, programs, cycles, connections, assignments, field configs, audit logs, progress
- **Encryption**: AES-256-GCM for Smartsheet tokens; `ENCRYPTION_KEY` env var (32-byte hex)
- **Runtime**: Default Node.js runtime for all API routes (no edge runtime used)

### Database schema (migrations in `supabase/migrations/`)

| Migration | Key tables |
|-----------|-----------|
| `001_initial_schema.sql` | users, sessions, programs, connections, cycles, roles, memberships, field_configs, field_permissions, view_configs, config_versions, audit_logs, user_cycle_progress, app_config |
| `002_program_admins.sql` | program_admins (scholarship admin scoping) |
| `003_scholarship_templates.sql` | scholarship_templates (reusable config presets) |
| `004_program_connections.sql` | Scopes connections to programs |

### Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `ENCRYPTION_KEY` | Yes | AES-256-GCM key for Smartsheet tokens (32-byte hex) |
| `ALLOWED_REVIEWER_EMAIL_DOMAIN` | No | Default `wsu.edu` — enforced on WSU-only cycles |

---

## Smartsheet API: Key Rules

Rules shared with the `smartsheets_view` platform. See `VERCEL_DEPLOYMENT.md` in that repo for full detail.

- **Never send `value: null`** — Smartsheet rejects explicit null. Use `""` to clear. `updateRowCells` now coerces `null → ""` automatically.
- **Column type normalization**: `c.type ?? c.columnType ?? "TEXT_NUMBER"` — both fields must be checked; already applied in `getSheetSchema`.
- **Structured error responses**: `updateRowCells` now parses the JSON error body and returns `{ httpStatus, errorCode }`. errorCode `4003` / HTTP `429` = rate limited.
- **CONTACT_LIST / MULTI_CONTACT_LIST**: Current implementation only reads and writes `value` (the display string). This works for text-based scores and comments. If a future field type requires writing structured contact data, `objectValue` handling must be added (see `smartsheets_view` for the cell shape rules).

---

## Fixes Applied (from smartsheets_view lessons)

These were identified by cross-referencing the two platforms and applied in March 2026.

### ✅ 1. DB pool connection limit (`src/lib/db.ts`)
Added `max: 2`, `idleTimeoutMillis: 10000`, `connectionTimeoutMillis: 5000` to the pool. Without `max: 2`, concurrent Vercel serverless function instances can exhaust Supabase's connection limit (20 on free tier).

### ✅ 2. Null value guard in `updateRowCells` (`src/lib/smartsheet.ts`)
Cells with `value: null` are now coerced to `value: ""` before the PUT request. Smartsheet rejects explicit JSON null; previously this would cause a silent failure or error 1008.

### ✅ 3. Structured Smartsheet error parsing (`src/lib/smartsheet.ts`)
Added `parseSmartsheetError` helper. `updateRowCells` now returns `{ httpStatus, errorCode }` alongside the error message instead of raw response body text.

### ✅ 4. 429 rate-limit passthrough (`src/app/api/reviewer/.../route.ts`)
Rate limit detection moved from fragile string-matching to `httpStatus === 429 || errorCode === 4003`. The route now returns HTTP 429 (not 500) when Smartsheet rate-limits the request, giving clients the correct signal for retry logic.

---

## Remaining Tasks

### 1. Smartsheet write path tests (next session)

The `updateRowCells` function and reviewer save route are currently untested. These are the highest-risk areas for silent data corruption. Tests to write (Vitest, in `src/lib/__tests__/`):

- `updateRowCells` null coercion: `null` → `""` in serialized payload
- `updateRowCells` error parsing: structured JSON error body → `{ httpStatus, errorCode }`
- `updateRowCells` rate limit: HTTP 429 from Smartsheet → `{ httpStatus: 429, errorCode: 4003 }`
- `parseSmartsheetError`: malformed JSON body falls back to raw text
- Reviewer POST route: 429 from `updateRowCells` → HTTP 429 response to client
- Reviewer POST route: timeout error → `retriable: true`, HTTP 500
- Reviewer POST route: non-editable column silently filtered from cells array

### 2. UI audit and polish

The platform is functionally complete but has not had a dedicated UX/accessibility pass. Review every screen against these standards before giving to end users:

**Accessibility**
- [ ] Skip link on every page (`<a href="#main" className="sr-only focus:not-sr-only ...">`)
- [ ] All form inputs have visible labels (not placeholder-only)
- [ ] Error messages use `role="alert"` so screen readers announce them
- [ ] Modals and drawers trap focus and close on Escape
- [ ] Interactive elements have `:focus-visible` ring styling
- [ ] Tables use `<thead>`, `<th scope="col/row">`, and `<caption>` where appropriate
- [ ] Color is not the only indicator of state (e.g. active/inactive badges also use text or icon)

**Consistency and polish**
- [ ] Loading states on all async actions (buttons show spinner / disabled state while submitting)
- [ ] Empty states on all list views (no blank space when there are no programs, cycles, nominees, etc.)
- [ ] Confirmation before destructive actions (delete program, delete cycle, remove assignment)
- [ ] Success feedback after saves (toast or inline confirmation — not just silent reload)
- [ ] Form validation errors shown inline next to the field, not just at the top
- [ ] Long text truncation with tooltip on hover for table cells (nominee names, program titles)
- [ ] Mobile responsiveness: reviewer nominee list and score form usable on tablet/phone
- [ ] Consistent heading hierarchy (h1 per page, h2 for sections — no skipped levels)
- [ ] Page titles (`<title>`) set correctly on every route via Next.js `metadata` export

**Reviewer experience specifically**
- [ ] Clear visual indication of save status (saved / saving / error) on the score form
- [ ] "Save & Next" skips already-scored nominees or goes to next in list — confirm behavior is intentional
- [ ] Blind review mode: verify identity/subtitle fields are fully suppressed in the reviewer UI (not just hidden via CSS)
- [ ] Attachment links open in a new tab and display a fallback when the signed URL has expired
- [ ] Progress indicator (e.g. "3 of 12 reviewed") visible on the nominee list

**Admin experience specifically**
- [ ] Field mapping builder: column type shown next to each column name so admin can make informed mapping decisions
- [ ] Schema drift warning is prominent and blocks publish — not just a small note
- [ ] Audit log: filterable by action type and date range; not just a raw list
- [ ] Cycle status transitions are explicit (draft → active → closed → archived) with confirmation

---

## Working Rules

1. When a fix is applied, move it from "Remaining Tasks" to "Fixes Applied" with a ✅.
2. Any change to `updateRowCells` or the reviewer write route must be classified against the Smartsheet API rules above — especially null handling and CONTACT_LIST objectValue rules.
3. JSX files: run `cat -A file.tsx | grep 'M-b'` after edits to catch Unicode smart quotes before pushing. See `VERCEL_DEPLOYMENT.md` in `smartsheets_view` for the fix command.
4. Production builds run TypeScript. Run `npx tsc --noEmit` locally before pushing.
5. No `--webpack` flag needed unless TipTap or another ProseMirror-based editor is added.

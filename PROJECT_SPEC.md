# Project Specification: Workflow Review Platform

Canonical product/spec document for this repo. For setup and deployment, see `README.md` and `instruction.md`.

---

## Spec changelog

- **2026-04-15 (follow-up)** — Independent review (Codex): fixed **`src/proxy.ts`** public-path logic — a `"/"` + `startsWith` entry had made **all** page routes appear public to the proxy (login redirect was dead). Spec/README corrected for **cookie vs DB session expiry**, **`NEXT_PUBLIC_APP_URL`** (not used to build signed file URLs), **template GET access** for program admins, **`must_change_password`** not enforced on most APIs, and backlog notes (CSRF posture, session revocation).
- **2026-04-15** — Security/architecture audit pass: documented request gating (`src/proxy.ts` as Next.js **Proxy** middleware), per-route API authorization, cron bearer behavior vs `CRON_SECRET`, public-intake controls and trust assumptions, dual use of `ENCRYPTION_KEY`, and dependency audit posture. Added **Current implementation (mirrors codebase)**. Refreshed env-var notes and backlog (login rate limiting, cron hardening).
- **2026-04-05** — Prior baseline: shipped behavior, layout system, Smartsheet attachment mirroring, RLS migration, reviewer roles.

**Last reviewed for code alignment:** 2026-04-15

---

## Platform Purpose

This app is a workflow layer on top of Smartsheet. It supports programs that keep structured row data in Smartsheet while the app owns workflow state, reviewer experience, public intake, files, assignments, and audit history.

The initial use case is graduate scholarship nomination review, but the platform is intentionally general enough for grants, requests, and similar review-cycle workflows.

Smartsheet remains the source of truth for structured row data. Postgres stores users, sessions, assignments, builder configuration, published snapshots, submission lifecycle state, file metadata (including intake attachment sync state), and audit logs. Vercel Blob stores uploaded file bytes privately (this app does **not** use Supabase Storage for binaries).

---

## Technical Architecture

- Framework: Next.js 16 App Router on Vercel
- Build command: `vercel.json` runs `npm run build` → `next build` (Turbopack is the default bundler for this Next.js version)
- Styling: Tailwind CSS v4
- Auth: custom DB-backed sessions with bcrypt (no third-party OAuth)
- Storage: PostgreSQL (app state), Smartsheet (row data), Vercel Blob (private uploads)
- Encryption: AES-256-GCM for Smartsheet tokens at rest (`src/lib/encryption.ts`, key material from `ENCRYPTION_KEY` via scrypt); HMAC-SHA256 for signed public/reviewer file URLs and for hashed intake rate-limit IPs (`src/lib/intake.ts`, same env string as secret material)
- Runtime: routes using `pg`, crypto, Blob tokens, or ZIP streams should explicitly export `runtime = "nodejs"`
- **Request gating:** `src/proxy.ts` is the Next.js **Proxy** entry (shown as “Proxy (Middleware)” in `next build` output). It redirects **protected page** navigations without a `session_id` cookie to `/login` (with `redirect=`). **Public document paths** (no cookie): `/` (home), `/login`, and `/submit/*` (public intake). **`/api/*` is not authenticated at the proxy layer**—each Route Handler calls `getSessionUser()` / `canManageCycle()` / `canManageProgram()` / platform-admin checks as appropriate. Intentionally public APIs include `/api/submit/*`, `/api/intake-files/*` (HMAC-signed query), and `/api/auth/login` / `/api/auth/logout`.

### Build guardrails

- `npm run build` is the source of truth for what Vercel executes.
- Do not add `--webpack` unless a reproduced production-build regression justifies it.
- Run `npx tsc --noEmit` when touching shared types, route contracts, or layout persistence.
- Run `npm test` (`vitest run`, see `package.json`) when changing auth, file handling, layout logic, or Smartsheet read/write paths.
- Run `npm run lint` before merge when touching `src/`.

---

## Current implementation (mirrors codebase)

This section summarizes **what the code does today** for security-sensitive and runtime behavior. Feature-level product detail remains in **What Is Built** and later sections.

### Auth and sessions

- **Model:** Email + password (`users.password_hash`, bcrypt cost 12). No OAuth or SSO.
- **Session storage:** `sessions` table (`id` UUID, `user_id`, `expires_at`, `revoked_at`, `last_seen_at`). Cookie name `session_id` holds the session UUID.
- **Cookie flags:** `httpOnly`, `sameSite: "lax"`, `path: "/"`, `secure` when `NODE_ENV === "production"`, `maxAge` set **once** at login from the same idle-timeout minutes as DB (`setSessionCookie` in `auth.ts`, called from `POST /api/auth/login` only).
- **DB expiry (sliding on server):** Each successful `getSessionUser()` extends `sessions.expires_at` and `last_seen_at`. **`SessionWarning`** polls `GET /api/auth/session-status` every minute, which calls `getSessionUser()` and therefore also extends DB expiry while a tab stays open.
- **Cookie vs DB mismatch:** The browser cookie **`maxAge` is not refreshed** on activity—only the row in `sessions` is extended. Users keep working until the cookie disappears or `getSessionUser()` rejects the row; behavior is “server-tracked idle” plus “fixed browser cookie lifetime from login,” not a single unified sliding window.
- **Invalidation:** `POST /api/auth/logout` revokes **only the current** session row and deletes the cookie. Password change does not revoke other sessions.
- **Enforcement:** `/admin` and `/reviewer` layouts call `getSessionUser()` and redirect; `must_change_password` forces `/change-password` in those layouts. **Most Route Handlers do not check `must_change_password`**—a client with a valid cookie could still call mutating admin/reviewer APIs until policy is tightened.
- **Server Actions are not used** (no `"use server"`); mutations go through Route Handlers.

### Request gating (Edge proxy)

- **`src/proxy.ts`:** Matcher excludes `_next/static`, `_next/image`, `favicon.ico`. **Protected pages** without `session_id` redirect to `/login`. **Public pages** without cookie: `/`, `/login`, `/submit/*`.
- **APIs:** All `/api/*` requests pass the proxy without session checks; authorization is **per handler** (`getSessionUser`, `canManageCycle`, `canManageProgram`, `is_platform_admin`, etc.).

### Authorization model (admin / reviewer)

- **Platform admin** (`users.is_platform_admin`): full program/cycle access; sole actor for global users, `connections` CRUD/rotate, program `POST`, **template create (`POST` templates)**, audit API, `app_config`.
- **Program admin** (`program_admins`): `canManageProgram` / `canManageCycle` for assigned programs only; cannot create connections or list all programs. **Template list and read** (`GET /api/admin/templates`, `GET /api/admin/templates/[id]`) allow any user who passes `canAccessAdmin()` (platform **or** program admin), same gate as the connections list for scholarship admins.
- **Reviewer:** `scholarship_memberships` + active cycle; `getReviewerRowContext` loads the sheet via the cycle’s connection and enforces **row-level** `filter_criteria_json` so arbitrary `rowId` paths cannot read other rows when the filter excludes them.
- **Legacy route:** `PATCH /api/admin/cycles/[id]/view-settings` returns **410 Gone** (cycle-level blind settings removed; blind is per-field in the reviewer builder).

### Public intake and uploads

- **Routes:** `GET/POST /api/submit/[cycleId]`, `POST .../upload-token`, `POST .../remove-upload`.
- **Submitter email:** `POST` submit path requires `@wsu.edu` (hardcoded suffix in `submit` route and intake validation), in addition to field-level email rules.
- **Abuse:** Honeypot field on submit and upload-token; `checkRateLimit` in `intake.ts` (per cycle, hashed IP, windows for `upload-token` vs `submit`); inserts one rate-limit row per check (see tests in `intake.test.ts`).
- **Client `submissionId`:** UUID v4 from the browser; staged blob paths include it; guessing others’ paths is infeasible under correct client behavior.
- **IP for rate limiting:** First address in `x-forwarded-for` when present, else `127.0.0.1` — **assumes a trusted edge** (e.g. Vercel) so the left-most hop is the client or platform-provided chain.

### File access

- **Intake/reviewer downloads:** HMAC query params (`expires`, `signature`); verified in `intake.ts` / `reviewer-attachments.ts`. Signed URLs are **relative paths** (e.g. `/api/intake-files/...`) — they do **not** embed `NEXT_PUBLIC_APP_URL`. Blob bytes via `@vercel/blob` `get` with `BLOB_READ_WRITE_TOKEN`. Treat signed links as **capability tokens** (leak = access until expiry); they are not bound to a session cookie.
- **Admin ZIP export:** `GET /api/admin/cycles/[id]/export-attachments` — `canManageCycle`, streamed ZIP (`attachment-export.ts` for safe entry names).

### Smartsheet integration

- **Base URL (fixed in code):** `https://api.smartsheet.com/2.0` in `src/lib/smartsheet.ts` (not env-configurable).
- **Credentials:** Stored encrypted in `connections.encrypted_credentials`; decrypted only on the server for API calls and schema tests.
- **Failures / 429:** Helpers parse JSON errors and propagate `httpStatus` / `errorCode` where applicable; write timeout optionally from `app_config` (`getSmartsheetWriteTimeoutMs` in `db.ts`).

### Data layer and RLS

- **Driver:** `pg` `Pool` singleton (`db.ts`): max 2 connections per warm serverless instance, idle/connection timeouts documented in code.
- **TLS:** Optional `DATABASE_CA_CERT`; `SCHOLARSHIP_DATABASE_INSECURE_SSL` gates relaxed TLS; raw `sslmode=no-verify` in URL rejected unless that flag is set.
- **RLS:** Migration `009_enable_public_rls.sql` enables RLS on listed `public` tables; app uses direct `pg`, not PostgREST — RLS is defense-in-depth for accidental Data API exposure.

### Cron / background HTTP

- **Routes:** `cleanup-blobs`, `sync-smartsheet-attachments` (see `vercel.json` schedules).
- **Auth:** Bearer compare to `process.env.CRON_SECRET` **only if** that env var is non-empty; see Environment Variables table.

### Caching

- **No app-wide `unstable_cache` / `revalidateTag` / `revalidatePath` usage found** in `src/`. Many Node-dependent Route Handlers omit `export const runtime = "nodejs"` and rely on Next.js defaults when they use `pg`, `bcrypt`, or Blob.

### CSRF and cookies

- **SameSite=Lax** on `session_id` is the primary browser mitigation for cross-site POSTs to same-origin APIs. **There is no custom Origin/Referer check or anti-CSRF token** on sampled cookie-authenticated `POST`/`PATCH`/`DELETE` handlers — document threat model for cross-site flows if the app is ever embedded or used from unusual referrer policies.

### Dependencies / verification commands

- From `package.json`: `npm test` (Vitest), `npm run lint` (ESLint), `npm run build` (`next build`). **CI status (2026-04-15):** all three passed locally on this audit.
- **`npm audit`:** reported upstream advisories affecting `next`, `vite` (dev), `picomatch`, `flatted`, `brace-expansion` — track upgrades on a separate change; not silently “fixed” in this spec pass.

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
| `010_smartsheet_attachment_sync.sql` | `push_to_smartsheet` on `intake_form_fields`; sync columns, indexes, and aggregate trigger on `intake_submission_files` / `intake_submissions` for asynchronous native `FILE` mirror to Smartsheet |

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `ENCRYPTION_KEY` | Yes (prod) | Master secret: drives AES-256-GCM for stored Smartsheet tokens **and** HMAC signing for intake/reviewer file URLs and intake rate-limit IP hashing (see `encryption.ts`, `intake.ts`). In non-production, file URL signing can fall back if unset—**always set in production**. |
| `NEXT_PUBLIC_APP_URL` | Yes in production (recommended) | Absolute base URL for **operator-facing copy/paste links** (e.g. intake URL on cycle admin page). **Not** used to construct HMAC-signed intake/reviewer file URLs (those are relative `/api/...` paths in code). |
| `BLOB_READ_WRITE_TOKEN` | Yes for file features | intake uploads, reviewer uploads, cleanup, signed access, ZIP export |
| `CRON_SECRET` | **Yes in any deployed environment** | Intended to protect `GET /api/admin/jobs/cleanup-blobs` and `GET /api/admin/jobs/sync-smartsheet-attachments`. **Implementation:** if this variable is **unset**, the cron routes **do not** enforce the bearer check (any caller can hit those endpoints). Operators must set `CRON_SECRET` and configure Vercel Cron to send `Authorization: Bearer <secret>`. |
| `ALLOWED_REVIEWER_EMAIL_DOMAIN` | No | Reviewer-assignment domain when the cycle does not allow external reviewers; defaults to `wsu.edu` in code (`assignments` API) |
| `DATABASE_CA_CERT` | No | PEM CA for strict TLS to Postgres (`db.ts`) |
| `SCHOLARSHIP_DATABASE_INSECURE_SSL` | No | When true, uses `sslmode=no-verify` (last resort; must be explicit) |
| `SEED_ADMIN_EMAIL` | No | local bootstrap admin email |
| `SEED_ADMIN_PASSWORD` | Local only | password for the initial seeded admin |

---

## Smartsheet API Rules

- **API host:** production traffic uses `https://api.smartsheet.com/2.0` (constant in `src/lib/smartsheet.ts`).
- Never send `value: null`. Use `""` to clear.
- Column type normalization: `column.type ?? column.columnType ?? "TEXT_NUMBER"`.
- Surface `httpStatus` and `errorCode` on Smartsheet failures, especially `429` / `4003`.
- PICKLIST writes use `strict: true`.
- CONTACT_LIST / MULTI_CONTACT_LIST are out of scope for public intake writes.
- MULTI_CONTACT_LIST clearing must use `{ "value": "" }`, not `values: []`.
- Native **FILE** mirroring from intake to Smartsheet row attachments is **shipped** (per-field opt-in). Smartsheet LINK attachments are not used for that path.

---

## Working Rules

1. When a fix ships, add it to Fixes Applied and update narrative sections so operators are not reading obsolete “planned” text.
2. Any change to Smartsheet write helpers must be evaluated against the rules above.
3. Watch for smart quotes or other non-ASCII punctuation in JSX after AI/editor edits.
4. Use `npx tsc --noEmit` as a fast precheck; treat `npm run build` as the final local verifier.
5. Do not add `--webpack` unless a reproduced production-build regression is documented.
6. Any new app-owned table added to `public` must enable RLS in the same migration that creates or exposes it.
7. After applying schema changes on Supabase, rerun Security Advisor and treat new `rls_disabled_in_public` findings as release-blocking until fixed.

---

## What Is Built

- Admin dashboard: programs, cycles, connections, users, reviewer assignments, templates
- **Program and cycle rename:** admins can change a program's `name` and `description` inline from the program detail page and a cycle's display label from the cycle detail page; program slug remains immutable after create
- Two-tier admin model: platform admin vs program admin
- Cycle setup: Smartsheet connection, sheet sync, cycle status, external reviewer options
- Reviewer builder: column mapping, purposes, field-level blind hide flags, optional per-field helper text, multi-role management, per-role view/edit permissions matrix with inline meaning guidance, row-based layout with 1/2/3-up desktop rows and drag row reorder, publish/unpublish, version snapshots, import/export/clone, delete/reset
- Public intake builder: draft/publish/unpublish, versioned snapshots, rich-text instructions, multi-file PDF uploads, delete guard, optional character limits for `short_text` and `long_text`, short-vs-narrative text input style for mapped Smartsheet text columns, row-based desktop layout with 1/2/3-up rows and drag row reorder
- Public submit workflow: direct Blob uploads, metadata-only submit route, Smartsheet row creation, submission idempotency, schema-drift detection, rate limiting, honeypot, optional async mirror of intake PDFs to Smartsheet row attachments (cron worker)
- Reviewer workflow: direct routing into applicant pages, progress tracking, Save and Next, merged attachment view (intake files opened via signed in-app URLs when the blob exists; Smartsheet-only attachments use Smartsheet download URLs; `deleted_from_blob` falls back to Smartsheet when the staged blob was removed), reviewer-uploaded attachments, per-role field visibility/editability, field-level blind hiding that overrides reviewer access at runtime, helper text/instructions, reviewer sign-out in the shell header, published-layout rendering from canonical `layout_json`
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
21. Smartsheet native attachment mirroring shipped: per-field `push_to_smartsheet`, async sync job (`/api/admin/jobs/sync-smartsheet-attachments`), simple-upload attach API, dedupe and retry policy, staged blob retention per migration `010`
22. Reviewer/admin merged attachments updated: list API hydrates missing Smartsheet download URLs when the list endpoint omits them; synced intake files prefer **signed app URLs** (`intake_upload_synced`) so reviewers open files from Blob-backed routes unless the blob was already removed (`deleted_from_blob` → Smartsheet URL)
23. **Living spec (2026-04-15):** `PROJECT_SPEC.md` updated to document proxy vs handler auth, `CRON_SECRET` / `ENCRYPTION_KEY` behavior, Smartsheet API base URL, RLS posture, verification commands, and a consolidated backlog — no product feature change
24. **Proxy public-path fix (2026-04-15):** `src/proxy.ts` no longer treats every path as public via `startsWith("/")`; login redirect applies to protected pages; `/submit/*` explicitly allowed for anonymous intake

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

## Smartsheet native attachment mirroring (shipped)

When **Push uploaded files to Smartsheet** is enabled on an intake **file** field, each submitted PDF is copied to the nominee row as a native Smartsheet **`FILE`** attachment. Upload bytes land in **Vercel Blob** first; mirroring is **asynchronous** via `GET /api/admin/jobs/sync-smartsheet-attachments` (Vercel cron; **secure only when** `CRON_SECRET` is set and the caller sends `Authorization: Bearer <CRON_SECRET>`). Submission success does not wait for mirroring.

**Caps:** 30 MB per file on push-enabled fields; 100 MB on fields without push. **Schema:** migration `010_smartsheet_attachment_sync.sql` (`push_to_smartsheet`, per-file `attachment_sync_status`, aggregate status on `intake_submissions`). **Attach API:** simple (non-multipart) body upload plus helpers in `src/lib/smartsheet.ts` (list pagination, optional URL hydration from `GET /sheets/{sheetId}/attachments/{attachmentId}` when the list response omits `url`).

**Merged attachments (reviewer + admin preview):** Intake files still in Blob are exposed as **`intake_upload_*` / `intake_upload_synced`** with signed links to `/api/intake-files/...`. Rows in **`deleted_from_blob`** after staged cleanup use Smartsheet download URLs when a matching row attachment exists. Purely Smartsheet attachments (no intake row) use Smartsheet URLs. Reviewer-uploaded files use `/api/reviewer-files/...` signed URLs.

**Operations:** See `vercel.json` for cron schedules (blob cleanup and attachment sync). `instruction.md` troubleshooting covers missing migration `010` and cron/auth failures.

---

## Backlog / refinements (not shipped)

Optional follow-ups — **not** implemented unless removed from this list after a code change.

### Security / operations

- **Login abuse:** `POST /api/auth/login` has no application-level rate limit or lockout (relies on infrastructure and bcrypt cost).
- **Cron hardening:** Fail closed (401) when `CRON_SECRET` is unset in `NODE_ENV=production`, or validate at startup.
- **Proxy cookie check:** Middleware only tests cookie **presence** for protected pages; invalid UUIDs still hit the server (layouts then redirect).
- **Session lifecycle:** Optional — revoke **all** sessions on password change; align cookie `maxAge` refresh with DB `expires_at` extension if a true end-to-end sliding window is required.
- **API `must_change_password`:** Optional — reject mutating admin/reviewer APIs when `must_change_password` is true (today enforced mainly in layouts).
- **Cookie-authenticated API CSRF:** Optional — explicit anti-CSRF tokens or Origin checks beyond `SameSite=Lax` if product threat model requires it.
- **Cron cleanup scalability:** `cleanup-blobs` lists all `intake/` blobs and queries DB per pathname (no `maxDuration`); monitor cost at scale.
- **Dependency advisories:** Periodically `npm audit` / bump `next` and dev toolchain per vendor guidance.
- **Hermetic builds:** `next build` may fetch Google Fonts from `src/app/layout.tsx`; parent-folder `package-lock.json` can confuse Turbopack root — set `turbopack.root` in `next.config.ts` or remove stray lockfiles if builds must be reproducible offline.

### Test coverage

- attachment export end-to-end behavior
- reviewer upload flows
- layout-builder save/publish edge cases
- intake publish/save/delete paths
- admin reset/delete safety flows
- attachment sync worker and Smartsheet attach edge cases (optional expansion)

### UX and accessibility

- mobile reviewer usability
- builder discoverability and empty states
- large-export user feedback
- admin recovery/error messaging around file-heavy workflows
- keyboard accessibility polish for the row-layout canvas

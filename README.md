# Scholarship Review Platform

Admin-managed application layer on top of Smartsheet for scholarship-style review workflows. Staff connect sheets, configure display/edit behavior, assign reviewers, and reviewers read/score/comment through a purpose-built interface.

## Stack

- **Next.js** (App Router) + TypeScript
- **Postgres** for app state, auth, config, assignments, audit
- **Smartsheet** as source of truth for row data (server-side proxy only)
- **Vercel** deployment target

## Setup

1. Clone and install:

   ```bash
   npm install
   ```

2. Configure environment (copy `.env.example` to `.env.local`):

   - `DATABASE_URL` – Postgres connection string
   - `ENCRYPTION_KEY` – 32+ char key for encrypting Smartsheet tokens (e.g. `openssl rand -hex 32`)

3. Apply schema and seed initial admin:

   ```bash
   npm run db:seed
   ```

   Requires `SEED_ADMIN_PASSWORD` (min 8 chars). Optional: `SEED_ADMIN_EMAIL` (default: `admin@example.com`).

4. Run dev server:

   ```bash
   npm run dev
   ```

5. Log in at `/login` with the seeded admin account.

## Project structure

- `src/app/` – Next.js App Router pages and API routes
- `src/lib/` – DB, auth, encryption, Smartsheet proxy
- `supabase/migrations/` – Postgres schema
- `scripts/` – Seed and utility scripts

## Build phases (from handoff)

- **Phase 0–1** (implemented): Auth, programs/cycles, users, assignments, connections, schema import, reviewer landing
- **Phase 2** (implemented): Smartsheet connection, schema sync
- **Phase 3** (implemented): Guided field-mapping builder
- **Phase 4** (implemented): Reviewer runtime (nominee list, scoring, Smartsheet writeback)
- **Phase 5** (implemented): Production hardening (audit logging, connection verification/rotation, schema drift warnings, smoke tests)
- **Phase 6** (implemented): Template and reuse (clone config from prior cycle, versioned config publishing)

## What was built (Phase 0 + Phase 1)

- **Auth**: Login, logout, DB-backed sessions, `must_change_password` flow, change-password page (redirects to /admin or /reviewer by role)
- **Admin boundary**: Only platform admins can access /admin; reviewers redirect to /reviewer
- **Admin**: Dashboard, Scholarships (programs + cycles), Users (create, reset password, activate/deactivate), Connections (encrypted Smartsheet tokens)
- **Cycle config**: Link connection + sheet ID, import schema from Smartsheet, allow_external_reviewers toggle
- **Assignments**: Assign users to cycles with roles, remove assignments
- **Session**: Cookie maxAge from app_config, session warning banner before expiry
- **Reviewer**: "My scholarships" page listing assigned active cycles (runtime stub for Phase 4)
- **Phase 3 Builder**: Field mapping (identity, narrative, score, comments), role visibility, layout selection (tabbed/stacked/accordion/list_detail), preview stub
- **Scholarship admin**: program_admins table; scholarship admins manage cycles, builder, assignments for their programs; connections remain platform-admin only
- **Phase 4 Reviewer**: Nominee list, detail view with narrative/score/comments, Smartsheet writeback, save-state handling (idle/saving/saved/failed, retriable vs fatal)
- **Phase 5**: Audit logging (user/program/connection/cycle/assignment/reviewer actions), connection test+rotate, schema drift warnings, vitest smoke tests
- **Phase 6**: Clone config from prior cycle (same program), config versioning on builder save, publish config
- **Post–Phase 6**: Audit/Activity UI (`/admin/audit`), timeout settings UI (`/admin/settings`), Save & Next, resume where left off, row loaded timestamp and refresh, read-only Smartsheet attachments, builder attachment purpose, config export/import, reusable scholarship templates

## Deferred

- **Middleware → proxy migration**: Next.js deprecation warning; migrate when ready.

## Security

- Smartsheet tokens are server-side only, encrypted in DB
- Session cookies are httpOnly and secure
- `.gitignore` excludes `.env`, `token.txt`, local DB files
- No plaintext secrets in tracked files

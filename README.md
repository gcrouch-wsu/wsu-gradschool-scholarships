# Scholarship Review Platform

Admin-managed workflow layer on top of Smartsheet for scholarship-style review cycles. Staff connect a sheet, build a public intake form, configure the reviewer-facing form, assign reviewers, and reviewers score/comment through the app while Smartsheet remains the source of truth for structured row data.

## Current capabilities

- Admin dashboard for programs, cycles, users, connections, templates, and assignments
- Public intake form builder with publish/unpublish, versioned snapshots, private Blob uploads, multi-file support, optional text-question character limits, short-vs-narrative text input style for Smartsheet text columns, drag-reorder row layout, and direct write to Smartsheet rows
- Reviewer form builder with role-aware field behavior, field-level blind hiding, per-role view/edit permissions, optional helper text, drag-reorder row layout, publish/unpublish, and version snapshots
- Reviewer workflow with progress tracking, Save and Next, row-level attachments, reviewer-uploaded attachments, and sign-out from the reviewer shell
- Admin preview and export tools, including ZIP export of intake attachments
- Audit logging, encrypted Smartsheet credentials, DB-backed sessions, and schema-drift protection

## Stack

- Next.js 16 App Router + TypeScript
- PostgreSQL for app-owned state
- Smartsheet for structured nominee row data
- Vercel Blob for private file storage
- Vercel for deployment

## Build contract

- `npm run build` is the production build command
- `package.json` currently runs plain `next build`
- On Next.js 16, that means Turbopack is the current production bundler for this repo
- Do not add `--webpack` unless a real production-build regression is reproduced and documented

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env.local` and set the required values:

   - `DATABASE_URL`: Postgres connection string
   - `ENCRYPTION_KEY`: 32+ character key used for Smartsheet credential encryption and other signing/hashing
   - `SEED_ADMIN_PASSWORD`: password for the initial admin created by the seed script

   Commonly needed additional values:

   - `SEED_ADMIN_EMAIL`: optional, defaults to `admin@example.com`
   - `NEXT_PUBLIC_APP_URL`: app base URL, required for production-facing links and signed file routes
   - `BLOB_READ_WRITE_TOKEN`: required for intake uploads, reviewer uploads, and attachment export
   - `CRON_SECRET`: required for protected cron-backed cleanup routes
   - `ALLOWED_REVIEWER_EMAIL_DOMAIN`: optional reviewer-assignment domain restriction, defaults to `wsu.edu`

3. Initialize a fresh database:

   ```bash
   npm run db:seed
   ```

   This applies the SQL files in `supabase/migrations/` and seeds the first admin.

4. Start the dev server:

   ```bash
   npm run dev
   ```

5. Log in at `/login`.

For more detailed local setup and operator notes, see [instruction.md](instruction.md).

## Database migrations

Current migration set:

- `001_initial_schema.sql`
- `002_program_admins.sql`
- `003_scholarship_templates.sql`
- `004_program_connections.sql`
- `005_intake_forms.sql`
- `006_reviewer_row_files.sql`
- `007_layout_json.sql`
- `008_reviewer_field_help_text.sql`
- `009_enable_public_rls.sql`

Important: deploying code is not enough by itself. New code that depends on new tables or columns still requires the matching SQL migration to be applied to the target database.

## Recommended local verification

Before pushing changes that touch routes, layout logic, auth, file handling, or Smartsheet writes:

```bash
npx tsc --noEmit
npm test
npm run build
```

## Deploying on Vercel

- Code changes: commit and push to GitHub, then wait for the Vercel deployment to finish
- Environment variable changes: add/update them in Vercel, then redeploy
- Database changes: apply the matching SQL migration to the production database separately

Typical production environment variables:

- `DATABASE_URL`
- `ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL`
- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET`

## Repo structure

- `src/app/`: pages and route handlers
- `src/lib/`: shared business logic, DB access, Smartsheet helpers, layout helpers
- `src/components/`: reusable UI components
- `supabase/migrations/`: SQL schema changes
- `scripts/`: seed and maintenance scripts

## Key docs

- [PROJECT_SPEC.md](PROJECT_SPEC.md): canonical platform architecture, current behavior, and remaining build specifications
- [instruction.md](instruction.md): operator-facing setup and deployment walkthrough

## Security notes

- Smartsheet credentials are stored encrypted in Postgres
- Auth uses DB-backed httpOnly sessions
- Smartsheet reads/writes are server-side only
- Intake uploads and reviewer uploads are private Blob objects surfaced through app-controlled routes
- Audit logs intentionally avoid storing full public submission payloads
- Public app tables now enable Postgres Row Level Security by migration. This app does not rely on Supabase PostgREST for table access; it uses server-side `pg` connections only.

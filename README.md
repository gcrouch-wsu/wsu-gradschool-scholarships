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

2. Configure environment (copy `.env.example` to `.env.local` and fill in):

   - `DATABASE_URL` – Postgres connection string
   - `ENCRYPTION_KEY` – 32+ char key for encrypting Smartsheet tokens (e.g. `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)

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

For detailed setup (first login, database creation, troubleshooting), see **[instruction.md](instruction.md)**.

## Deploying (Vercel)

- **Code changes:** Commit and push to GitHub. Vercel auto-deploys on push.
- **Environment variable changes:** Redeploy in Vercel (Deployments → ⋮ → Redeploy). No commit needed.

## Project structure

- `src/app/` – Next.js App Router pages and API routes
- `src/lib/` – DB, auth, encryption, Smartsheet proxy
- `supabase/migrations/` – Postgres schema
- `scripts/` – Seed and utility scripts

## Features

- **Admin:** Programs, cycles, connections, users, assignments, field-mapping builder, config publish/unpublish, blind review, templates
- **Reviewer:** Assigned cycles, nominee list, scoring and comments, Save & Next, resume where left off, read-only attachments
- **Security:** Encrypted Smartsheet tokens, httpOnly sessions, server-side field permissions, audit logging

## Security

- Smartsheet tokens are server-side only, encrypted in DB
- Session cookies are httpOnly and secure
- `.gitignore` excludes `.env`, `token.txt`, local DB files
- No plaintext secrets in tracked files

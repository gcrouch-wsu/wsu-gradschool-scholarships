# Local setup with Docker

Run the Scholarship Review Platform on your machine using **Docker for Postgres**. You do **not** need to install PostgreSQL on Windows — only Docker Desktop and Node.js.

For production/Vercel deployment, see [instruction.md](instruction.md). For general project overview, see [README.md](README.md).

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Runs Postgres in a container |
| [Node.js](https://nodejs.org/) (LTS) | `npm install`, dev server, seed script |

Confirm Docker is running:

```bash
docker --version
docker ps
```

---

## 1. Clone and install dependencies

```bash
cd wsu-gradschool-scholarships
npm install
```

---

## 2. Start Postgres with Docker

Create and start a Postgres 16 container:

```bash
docker run --name scholarship-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=scholarship_review \
  -p 5432:5432 \
  -d postgres:16
```

| Setting | Value |
|---------|-------|
| Container name | `scholarship-pg` |
| Database | `scholarship_review` |
| User / password | `postgres` / `postgres` |
| Host port | `5432` |

Verify it is running:

```bash
docker ps
```

You should see `scholarship-pg` with `0.0.0.0:5432->5432/tcp`.

### If the container already exists

Start it again (data persists in the container volume):

```bash
docker start scholarship-pg
```

### Stop / remove (optional)

```bash
docker stop scholarship-pg
docker rm scholarship-pg
```

Removing the container deletes its data unless you used a named volume.

---

## 3. Create `.env.local`

Create `.env.local` in the project root (Next.js loads it automatically).

### Minimum for login and admin UI

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scholarship_review
ENCRYPTION_KEY=your-64-char-hex-key-here
SEED_ADMIN_EMAIL=your-email@wsu.edu
SEED_ADMIN_PASSWORD=YourPassword123
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`SEED_ADMIN_PASSWORD` must be at least 8 characters. It is used only by `npm run db:seed`.

### Optional (recommended)

```env
CRON_SECRET=any-long-random-secret
ALLOWED_REVIEWER_EMAIL_DOMAIN=wsu.edu
```

### Required for file uploads and exports

Intake PDFs, reviewer uploads, and ZIP export need Vercel Blob:

```env
BLOB_READ_WRITE_TOKEN=your-vercel-blob-token
```

Get this from a Vercel project → **Storage** → **Blob**. The rest of the app works without it.

### Not needed for local Docker Postgres

Leave these unset unless you hit SSL errors with a cloud database:

- `DATABASE_CA_CERT`
- `SCHOLARSHIP_DATABASE_INSECURE_SSL`

---

## 4. Initialize the database

Applies all SQL files in `supabase/migrations/` and creates the first platform admin:

```bash
npm run db:seed
```

Expected output includes lines like `Applied 001_initial_schema.sql` and `Created platform admin: your-email@wsu.edu`.

If you see `Users exist. Skipping seed.`, the database was already seeded.

---

## 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000/login](http://localhost:3000/login).

Sign in with `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`. You may be prompted to change your password on first login.

---

## 6. What works locally vs what needs extra setup

| Feature | Local Docker setup |
|---------|-------------------|
| Login, programs, cycles, forms | Works with steps above |
| Smartsheet sync | Add a connection in admin **Connections** (Smartsheet API token) |
| File uploads / attachment export | Needs `BLOB_READ_WRITE_TOKEN` |
| Cron jobs (blob cleanup, Smartsheet attachment sync) | Run on Vercel in production; optional to test locally |

---

## Daily workflow

```bash
# 1. Ensure Docker Desktop is running
docker start scholarship-pg

# 2. Start the app
npm run dev
```

---

## Troubleshooting

| Problem | What to do |
|---------|------------|
| `connect ECONNREFUSED 127.0.0.1:5432` | Start Docker Desktop; run `docker start scholarship-pg` |
| `port is already allocated` | Another Postgres is using 5432 — stop it or change the Docker port (e.g. `-p 5433:5432` and update `DATABASE_URL`) |
| `DATABASE_URL is required` | Add `DATABASE_URL` to `.env.local` |
| `SEED_ADMIN_PASSWORD must be at least 8 characters` | Use a longer password in `.env.local` |
| Missing table/column errors | Run `npm run db:seed` on a fresh database |
| Blob upload errors | Set `BLOB_READ_WRITE_TOKEN` in `.env.local` |

### Inspect the database (optional)

```bash
docker exec -it scholarship-pg psql -U postgres -d scholarship_review
```

### Reset database from scratch

```bash
docker stop scholarship-pg
docker rm scholarship-pg
docker run --name scholarship-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=scholarship_review \
  -p 5432:5432 \
  -d postgres:16
npm run db:seed
```

---

## Optional: verify before pushing changes

```bash
npx tsc --noEmit
npm test
npm run build
```

---

## Quick reference

```bash
docker run --name scholarship-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=scholarship_review -p 5432:5432 -d postgres:16
# set .env.local
npm run db:seed
npm run dev
# http://localhost:3000/login
```

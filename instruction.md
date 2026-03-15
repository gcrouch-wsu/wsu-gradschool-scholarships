# Scholarship Review Platform — Getting Started

---

## I'm at the login page. What do I do?

You need to create the first admin account. The app doesn't have a "sign up" button — you create the first user by running a one-time setup script on your computer.

### Step 1: Open your project folder

On your computer, open the folder where the scholarship-review-platform code lives (the one you pushed to GitHub).

### Step 2: Get your database URL

You need the same `DATABASE_URL` that Vercel uses.

**In Vercel:** Open your project → **Settings** (top nav) → **Environment Variables** (left sidebar).

**If the list is empty** — you need to add variables first. This app needs Postgres. Vercel Storage may only show Blob and Edge Config; use **Supabase** (free) instead:

1. **Create a Supabase database.** Go to [supabase.com](https://supabase.com) → Sign up → **New project** → pick a name and password. Wait for it to finish.
2. **Get the connection string.** In Supabase: **Project Settings** (gear) → **Database** → under "Connection string" choose **URI**. Copy it and replace `[YOUR-PASSWORD]` with your project password.
3. **Add variables in Vercel.** Go back to Vercel → **Settings** → **Environment Variables** → **Add New**:
   - `DATABASE_URL` = (paste the Supabase URI; use the **Transaction** pooler on port 6543 for serverless)
   - `ENCRYPTION_KEY` = run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` on your computer and paste the output
4. **Redeploy** (Deployments → ⋮ on latest → Redeploy).

**If you already have variables:** Find `DATABASE_URL` or `POSTGRES_URL` and copy its value.

### Step 3: Run the setup script

Open a terminal in your project folder and run:

```bash
DATABASE_URL="paste-your-database-url-here" SEED_ADMIN_EMAIL="you@wsu.edu" SEED_ADMIN_PASSWORD="ChooseAStrongPassword123" npm run db:seed
```

Replace:
- `paste-your-database-url-here` with your actual database URL (keep the quotes)
- `you@wsu.edu` with the email you want to use to log in
- `ChooseAStrongPassword123` with a password you'll remember (at least 8 characters)

**Example:**
```bash
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require" SEED_ADMIN_EMAIL="gcrouch@wsu.edu" SEED_ADMIN_PASSWORD="MySecurePass123" npm run db:seed
```

You should see output like:
```
Applied 001_initial_schema.sql
Applied 002_program_admins.sql
...
Created platform admin: gcrouch@wsu.edu
```

### Step 4: Log in

1. Go back to your Vercel app (the login page)
2. Enter the email and password you used in the script
3. Click **Log in**
4. You'll be asked to change your password — do that, then you're in

---

## What can I do after logging in?

As the first admin, you have full access. Here's the order of operations:

| Step | What to do | Where |
|------|------------|-------|
| 1 | Create a program (e.g. "Graduate School Scholarships") | **Scholarships** → **Add program** |
| 2 | Add a Smartsheet connection (so the app can read your sheets) | **Connections** → **Add connection** |
| 3 | Create a cycle (e.g. "Spring 2025") | Open your program → **Add cycle** |
| 4 | Connect the cycle to a Smartsheet | On the cycle page, pick the connection and sheet |
| 5 | Map fields (which columns are scores, narratives, etc.) | **Configure fields & layout** |
| 6 | Publish the config | **Publish** button on the cycle page |
| 7 | Assign reviewers | **Assigned reviewers** section on the cycle page |

---

## Two kinds of admins

| Role | What they can do |
|------|------------------|
| **Platform admin** (you) | Everything: create programs, cycles, connections, users, settings. |
| **Scholarship admin** | Manages only the programs you assign them to. Can configure cycles and assign reviewers, but can't create new programs or see connections/users. |

**To add another platform admin:** **Users** → **Create user** → check **Platform admin**.

**To add a scholarship admin:** Open a program → **Scholarship admins** → pick a user → **Add**.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| I only have Blob / Edge Config (no Postgres) | Use Supabase instead: [supabase.com](https://supabase.com) → create a project → get the database URI → add `DATABASE_URL` and `ENCRYPTION_KEY` in Vercel. See Step 2 above. |
| "DATABASE_URL is not set" when running seed | You must pass `DATABASE_URL` in the command. Copy it from Vercel → Settings → Environment Variables (or from the Storage database's connection string). |
| Seed says "Users exist. Skipping seed." | An admin was already created. Use that account, or create a new one via **Users** → **Create user** (you need to be logged in first). |
| Can't log in / wrong password | Run the seed again with a new password. (Seed only creates a user if the users table is empty.) |
| No **Connections** or **Users** in the nav | You're logged in as a scholarship admin. Only platform admins see those. The first user from the seed is always a platform admin. |

---

## Environment variables (for reference)

If you're setting up Vercel or local dev, you need:

| Variable | Required | What it's for |
|----------|----------|---------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `ENCRYPTION_KEY` | Yes | Encrypts Smartsheet tokens. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ALLOWED_REVIEWER_EMAIL_DOMAIN` | No | Default `wsu.edu`. When a cycle is "WSU-only," only users with this email domain can be assigned. |

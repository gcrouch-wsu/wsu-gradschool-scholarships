# Scholarship Review Platform - Operator Guide

This guide is for people installing and operating the app through Vercel. It covers:

- first-time install
- first login
- platform admin tasks
- scholarship admin tasks
- what to do when code, environment variables, or database schema change

Use this together with [README.md](README.md) and [PROJECT_SPEC.md](PROJECT_SPEC.md).

---

## Quick orientation

There are two admin levels:

- **Platform admin**: can manage users, Smartsheet connections, all programs, and all cycles
- **Scholarship admin**: can manage only the programs they are assigned to; they can configure cycles, forms, and reviewer assignments, but they cannot manage global users or Smartsheet connection secrets

The app uses:

- **Smartsheet** for structured row data
- **Postgres** for app state
- **Vercel Blob** for private file uploads

Reviewer entry URL:

- reviewers start at `/reviewer`
- if not logged in, they are redirected to `/login`
- the reviewer header now includes **Sign out**

---

## When to commit, redeploy, or run SQL

- **Code changed** (`.ts`, `.tsx`, `.sql`, docs, etc.): commit and push to GitHub. Vercel deploys from the push.
- **Environment variables changed in Vercel**: redeploy in Vercel. No commit needed for env-var-only changes.
- **Database schema changed** (new migration file or code depending on new tables/columns): apply the SQL migration to the target database separately. A Vercel deploy does not run migrations automatically.
- **Code + env vars both changed**: commit and push first, then redeploy in Vercel so the new deployment picks up the new env vars.
- **Supabase Security Advisor warns that public tables have RLS disabled**: apply the latest migration set. The app now expects public app tables to have RLS enabled because those tables are backend-owned and should not be exposed through Supabase's Data API.

---

## Part 1: First-time install on Vercel

### Step 1: Create the Vercel project

1. Push this repo to GitHub.
2. In Vercel, click **Add New** -> **Project**.
3. Import the GitHub repo.
4. Leave the framework as Next.js.
5. Let Vercel create the project.

Do not worry if the first deployment is incomplete because environment variables are still missing. That is normal during first install.

### Step 2: Create the database

You need a Postgres database before the app can work.

#### Option A: Use Vercel Storage

1. Open your Vercel project.
2. Click **Storage**.
3. Click **Create Database**.
4. Choose **Supabase** if available.
5. Attach it to the project.

Vercel may add a provider connection string automatically. If you only see `POSTGRES_URL`, add `DATABASE_URL` yourself with the same value.

#### Option B: Use Supabase directly

1. Create a project at [https://supabase.com](https://supabase.com).
2. Open the Supabase project.
3. Go to **Project Settings** -> **Database**.
4. Copy the **URI** connection string.
5. Replace `[YOUR-PASSWORD]` in the URI with your real DB password.

### Step 3: Create Blob storage

Blob is required for intake uploads, reviewer uploads, and attachment export.

1. In Vercel, open your project.
2. Click **Storage**.
3. Click **Add Storage** or **Browse Marketplace**.
4. Choose **Blob**.
5. Attach it to the project.

Vercel should create `BLOB_READ_WRITE_TOKEN` automatically for the attached project.

### Step 4: Add environment variables

In Vercel, go to **Settings** -> **Environment Variables** and make sure these exist for **Production**:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `ENCRYPTION_KEY` | Yes | Generate a random 32-byte hex string |
| `NEXT_PUBLIC_APP_URL` | Yes | Production base URL, e.g. `https://your-project.vercel.app` |
| `BLOB_READ_WRITE_TOKEN` | Yes | Usually added automatically when Blob is attached |
| `CRON_SECRET` | Yes | Any long random secret string |
| `ALLOWED_REVIEWER_EMAIL_DOMAIN` | Optional | Usually `wsu.edu` |

#### Generate `ENCRYPTION_KEY`

Use either shell:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

#### Set `NEXT_PUBLIC_APP_URL`

Use the real production base URL:

- custom domain if you have one
- otherwise the `*.vercel.app` production URL

Do not include a trailing slash.

#### Set `CRON_SECRET`

Generate any long random string. Example in PowerShell:

```powershell
[guid]::NewGuid().ToString("N")
```

### Step 5: Redeploy after env vars are set

After adding or changing env vars:

1. Open **Deployments** in Vercel.
2. Open the latest deployment.
3. Click `...`
4. Click **Redeploy**
5. Wait for it to show **Ready**

### Step 6: Run the initial database setup

The easiest way to initialize a brand-new database is to run the seed script from your machine against the production `DATABASE_URL`.

Use the same `DATABASE_URL` you configured in Vercel.

#### Bash

```bash
DATABASE_URL="paste-your-database-url-here" SEED_ADMIN_EMAIL="your-email@example.com" SEED_ADMIN_PASSWORD="YourPassword123" npm run db:seed
```

#### PowerShell

```powershell
$env:DATABASE_URL="paste-your-database-url-here"; $env:SEED_ADMIN_EMAIL="your-email@example.com"; $env:SEED_ADMIN_PASSWORD="YourPassword123"; npm run db:seed
```

This script:

- applies the SQL files in `supabase/migrations/`
- creates the first platform admin if the users table is empty

### Step 7: Log in

1. Open the deployed app.
2. Go to `/login`.
3. Sign in using the same email and password you used in the seed step.
4. Change the password when prompted.

At this point, the app is installed.

---

## Part 2: Platform admin guide

Platform admins can see:

- **Scholarships**
- **Users**
- **Connections**

### Recommended first-time platform admin checklist

1. Create or confirm a Smartsheet connection under **Connections**.
2. Create a program under **Scholarships** -> **Add program**.
3. Open the program and add one or more **Scholarship admins** if the program will be managed by staff who are not platform admins.
4. Create a cycle inside the program with **Add cycle**.
5. On the cycle page:
   - choose the Smartsheet connection
   - enter the Smartsheet Sheet ID
   - click **Sync columns from Smartsheet**
6. Build the public intake form if needed:
   - click **Build intake form**
   - save draft
   - publish
7. Build the reviewer-facing form:
   - open **Reviewer intake form**
   - map columns, set reviewer `View` / `Edit` permissions and any blind-hidden fields, arrange layout, save
   - publish updates
8. Assign reviewers in **Assigned reviewers**.
9. Activate the cycle so reviewers can see it.

### Platform admin tasks by area

#### Users

Use **Users** to:

- create user accounts
- make other platform admins
- create reviewer or scholarship-admin accounts

#### Connections

Use **Connections** to:

- create Smartsheet API connections
- update connection labels
- manage which credentials the app can use

Scholarship admins do not manage connection secrets directly.

#### Programs

Use **Scholarships** to:

- create programs
- open program details
- manage scholarship admins for a specific program
- delete a program if necessary

#### Cycles

On each cycle page, platform admins can:

- connect and sync the Smartsheet sheet
- build and publish the nomination intake form
- build and publish the reviewer form
- assign reviewers
- activate or deactivate the cycle
- export attachments

---

## Part 3: Scholarship admin guide

Scholarship admins manage only the programs assigned to them.

They can:

- open their assigned program(s)
- create and manage cycles inside those programs
- configure intake and reviewer forms
- assign reviewers
- activate cycles

They cannot:

- manage global users
- see the **Users** page
- manage global Smartsheet connection secrets
- create new platform-level connections outside the allowed program scope

### Scholarship admin cycle workflow

1. Open **Scholarships**.
2. Open your assigned program.
3. Click **Add cycle** if a cycle does not exist yet.
4. On the cycle page:
   - select the allowed Smartsheet connection
   - enter the Smartsheet Sheet ID
   - click **Sync columns from Smartsheet**
5. Configure the **Nomination intake form** if the cycle needs public intake:
   - click **Build intake form** or **Edit intake form**
   - add questions from synced Smartsheet columns
   - arrange rows and columns, including drag-reordering layout rows
   - save draft
   - publish
   - optionally use **View live form**
6. Configure the **Reviewer intake form**:
   - open the reviewer form builder
   - map columns and choose reviewer behavior
   - set reviewer `View` / `Edit` permissions and mark any blind-hidden fields directly in the builder
   - arrange rows and columns, including drag-reordering layout rows
   - save configuration
   - publish updates
   - use **View live form** to verify the reviewer experience
7. Assign reviewers in **Assigned reviewers**.
8. Activate the cycle when it is ready for review.

### Important scholarship admin notes

- If Smartsheet columns change, click **Sync columns from Smartsheet** again before editing forms.
- Schema sync refreshes draft mapped metadata such as synced column titles and intake picklist options. Republish the intake or reviewer form afterward if the live published form needs those updates.
- The nomination intake form and reviewer form are separate.
- Publishing the reviewer form is separate from publishing the nomination intake form.
- Blind-hidden reviewer fields are configured only inside the reviewer form builder. There is no separate cycle-level blind toggle.
- `View live form` on the reviewer side opens the live reviewer experience, not a public URL.

---

## Part 4: Intake form basics

The nomination intake form is the public-facing form used to create or update Smartsheet-backed nominations.

Key behaviors:

- it writes structured field data into Smartsheet
- uploads go to private Blob, not directly into Smartsheet
- PDFs can be uploaded as single-file or multi-file fields
- mapped Smartsheet text columns can use short or long narrative input style
- the form can be drafted, published, unpublished, or deleted
- delete is guarded once submission history exists

### Typical intake form flow

1. Open the cycle page.
2. Click **Build intake form**.
3. Add questions from synced Smartsheet columns for structured data.
4. Add file-upload questions for PDFs as needed.
5. Arrange layout in rows. Drag row cards to reorder them; Up/Down remains available as a fallback.
6. Click **Save Draft**.
7. Click **Publish Form**.
8. Use **View live form** from the cycle page to verify it.

---

## Part 5: Reviewer form basics

The reviewer form controls what reviewers see and edit when they review a nominee.

Key behaviors:

- it is separate from the public intake form
- it uses reviewer roles and permissions
- blind-hidden fields are configured per field inside the reviewer builder and override reviewer access at runtime
- it supports row-based layout with drag row reorder
- reviewers enter at `/reviewer` and can sign out from the reviewer header
- the published reviewer config is versioned separately

### Typical reviewer form flow

1. Open the cycle page.
2. Go to **Reviewer intake form**.
3. Map the synced Smartsheet columns to reviewer-facing fields.
4. Set reviewer visibility/editability and any blind-hidden fields.
5. Arrange the row layout. Drag rows to reorder them, or use Up/Down for fine adjustment.
6. Click **Save configuration**.
7. Click **Publish updates**.
8. Click **View live form** to verify the live reviewer experience.

If any fields are marked **Blind**, verify the live reviewer view before assigning real reviewers.

---

## Part 6: Updating production later

### If only code changed

1. Commit and push the code.
2. Wait for the Vercel deployment to finish.

### If only env vars changed

1. Update env vars in Vercel.
2. Redeploy the latest deployment.

### If a new SQL migration was added

1. Commit and push the code.
2. Wait for deploy to finish.
3. Apply the new SQL migration to the production database.
4. Test the affected feature.

Do not assume Vercel deploys run SQL migrations for you.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| `DATABASE_URL is not set` while seeding | Copy the production DB connection string into `DATABASE_URL` and rerun `npm run db:seed` |
| Blob uploads do not work | Confirm Blob is attached in Vercel Storage and `BLOB_READ_WRITE_TOKEN` exists |
| Cron-backed cleanup routes fail | Confirm `CRON_SECRET` is set |
| A cycle page says the intake schema is unavailable | Apply the missing SQL migration to the database |
| Reviewer or intake columns look wrong after Smartsheet changes | Click **Sync columns from Smartsheet** again, then republish if you need the live published forms to pick up refreshed draft metadata |
| Login works locally but not in production | Recheck `DATABASE_URL`, `ENCRYPTION_KEY`, and whether the production DB was seeded |
| A code deploy succeeds but a feature still fails with missing-table errors | The code is deployed but the matching SQL migration was not applied |

---

## Minimum production checklist

Before handing the app to real users, confirm all of these:

- Vercel deployment is **Ready**
- `DATABASE_URL` is set
- `ENCRYPTION_KEY` is set
- `NEXT_PUBLIC_APP_URL` is set
- `BLOB_READ_WRITE_TOKEN` is set
- `CRON_SECRET` is set
- the latest SQL migrations are applied
- you can log in as a platform admin
- you can create a program
- you can create a cycle
- you can sync a Smartsheet sheet
- you can publish an intake form
- you can publish a reviewer form
- you can assign a reviewer
- the reviewer can open the live review page

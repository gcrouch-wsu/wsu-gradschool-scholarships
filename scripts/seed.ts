/**
 * Seed script: creates initial platform admin and applies schema.
 * Run with: npx tsx scripts/seed.ts
 * Requires DATABASE_URL in environment.
 *
 * Creates one platform admin if users table is empty.
 * Password is passed via SEED_ADMIN_PASSWORD env var (min 8 chars).
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import { Pool } from "pg";
import bcrypt from "bcryptjs";
import * as fs from "fs";
import * as path from "path";

const DATABASE_URL = process.env.DATABASE_URL;
const SEED_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

async function main() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  if (!SEED_PASSWORD || SEED_PASSWORD.length < 8) {
    console.error("SEED_ADMIN_PASSWORD must be at least 8 characters");
    process.exit(1);
  }

  const withoutSslmode = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, (_, p) => (p === "?" ? "?" : "")).replace(/\?$/, "");
  const connectionString = withoutSslmode + (withoutSslmode.includes("?") ? "&" : "?") + "sslmode=no-verify";
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  try {
    const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const migration = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      await pool.query(migration);
      console.log(`Applied ${file}`);
    }

    const { rows } = await pool.query("SELECT id FROM users LIMIT 1");
    if (rows.length > 0) {
      console.log("Users exist. Skipping seed.");
      return;
    }

    const hash = await bcrypt.hash(SEED_PASSWORD, 12);
    await pool.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, must_change_password, is_platform_admin, status)
       VALUES ($1, $2, $3, $4, true, true, 'active')`,
      [SEED_EMAIL, "Platform", "Admin", hash]
    );
    console.log(`Created platform admin: ${SEED_EMAIL}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

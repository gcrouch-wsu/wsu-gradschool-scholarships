/**
 * Postgres connection pool for the scholarship review platform.
 * Uses DATABASE_URL from environment (Vercel Postgres or external).
 */
import { Pool } from "pg";

const globalForDb = globalThis as unknown as { pool: Pool | undefined };

export function getPool(): Pool {
  if (!globalForDb.pool) {
    let connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Configure Postgres connection for local dev and Vercel."
      );
    }
    const withoutSslmode = connectionString.replace(/([?&])sslmode=[^&]*/g, (_, p) => (p === "?" ? "?" : "")).replace(/\?$/, "");
    connectionString = withoutSslmode + (withoutSslmode.includes("?") ? "&" : "?") + "sslmode=no-verify";
    globalForDb.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }
  return globalForDb.pool;
}

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const pool = getPool();
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

type QueryFn = <T = unknown>(
  text: string,
  params?: unknown[]
) => Promise<{ rows: T[]; rowCount: number }>;

/**
 * Run multiple queries in a transaction. Rolls back on error.
 */
export async function withTransaction<T>(
  fn: (query: QueryFn) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const txQuery = async <T = unknown>(
      text: string,
      params?: unknown[]
    ): Promise<{ rows: T[]; rowCount: number }> => {
      const result = await client.query(text, params);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount ?? 0,
      };
    };
    const result = await fn(txQuery);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Smartsheet write timeout in ms. Per handoff: default 30s, override range 15–60s. */
export async function getSmartsheetWriteTimeoutMs(): Promise<number> {
  try {
    const { rows } = await query<{ val: number }>(
      "SELECT (value_json::text)::int as val FROM app_config WHERE key = 'smartsheet_write_timeout_seconds'"
    );
    const sec = rows[0]?.val;
    if (typeof sec === "number" && sec >= 15 && sec <= 60) return sec * 1000;
  } catch {
    /* fall through */
  }
  return 30000;
}

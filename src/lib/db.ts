/**
 * Postgres connection pool for the scholarship review platform.
 * Uses DATABASE_URL from environment (Vercel Postgres or external).
 */
import { Pool } from "pg";
import type { PoolConfig } from "pg";

const globalForDb = globalThis as unknown as { pool: Pool | undefined };
const INSECURE_SSL_ENV_VAR = "SCHOLARSHIP_DATABASE_INSECURE_SSL";
const DATABASE_CA_CERT_ENV_VAR = "DATABASE_CA_CERT";
const DEFAULT_POOL_OPTIONS = {
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
} satisfies Pick<PoolConfig, "max" | "idleTimeoutMillis" | "connectionTimeoutMillis">;

export function isDatabaseInsecureSslEnabled(): boolean {
  const raw = process.env[INSECURE_SSL_ENV_VAR]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function getDatabaseCaCert(): string | null {
  const raw = process.env[DATABASE_CA_CERT_ENV_VAR];
  if (!raw?.trim()) {
    return null;
  }
  return raw.replace(/\\n/g, "\n").trim();
}

function normalizeQueryString(url: string): string {
  return url.replace(/\?&+/g, "?").replace(/&&+/g, "&").replace(/[?&]$/g, "");
}

function stripNoVerifySslmodeParams(rawUrl: string): string {
  return normalizeQueryString(
    rawUrl
      .replace(/([?&])sslmode=no-verify\b/gi, (_, p: string) => (p === "?" ? "?" : ""))
      .replace(/([?&])sslmode=no%2dverify\b/gi, (_, p: string) => (p === "?" ? "?" : ""))
      .replace(/([?&])sslmode=no%2Dverify\b/gi, (_, p: string) => (p === "?" ? "?" : ""))
  );
}

function stripAnySslmodeParams(rawUrl: string): string {
  return normalizeQueryString(
    rawUrl.replace(/([?&])sslmode=[^&]*/gi, (_, p: string) => (p === "?" ? "?" : ""))
  );
}

function urlStillRequestsNoVerify(url: string): boolean {
  return /sslmode\s*=\s*no-verify\b/i.test(url) || /sslmode\s*=\s*no%2dverify\b/i.test(url);
}

export function buildDatabasePoolOptions(rawUrl: string): PoolConfig {
  if (isDatabaseInsecureSslEnabled()) {
    const stripped = stripAnySslmodeParams(rawUrl);
    const connectionString = `${stripped}${stripped.includes("?") ? "&" : "?"}sslmode=no-verify`;
    return {
      connectionString,
      ssl: { rejectUnauthorized: false },
      ...DEFAULT_POOL_OPTIONS,
    };
  }

  const ca = getDatabaseCaCert();
  const connectionString = ca ? stripAnySslmodeParams(rawUrl) : stripNoVerifySslmodeParams(rawUrl);
  if (urlStillRequestsNoVerify(connectionString)) {
    throw new Error(
      `${INSECURE_SSL_ENV_VAR} must be true before DATABASE_URL can disable TLS verification.`
    );
  }

  return {
    connectionString,
    ...(ca ? { ssl: { rejectUnauthorized: true, ca } } : {}),
    ...DEFAULT_POOL_OPTIONS,
  };
}

export function getPool(): Pool {
  if (!globalForDb.pool) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Configure Postgres connection for local dev and Vercel."
      );
    }
    globalForDb.pool = new Pool(buildDatabasePoolOptions(connectionString));
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

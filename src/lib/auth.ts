/**
 * App-managed authentication.
 * - DB-backed sessions for revocation
 * - Secure httpOnly cookies
 * - must_change_password enforcement
 * - Default idle timeout: 120 min, warning: 10 min before
 */
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { query } from "./db";

const SESSION_COOKIE = "session_id";
const IDLE_TIMEOUT_MIN = 120;
const WARNING_MIN = 10;

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  must_change_password: boolean;
  is_platform_admin: boolean;
  status: string;
}

export interface SessionUser extends User {
  sessionId: string;
  expiresAt: Date;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function getIdleTimeoutMinutes(): Promise<number> {
  try {
    const { rows } = await query<{ val: number }>(
      "SELECT (value_json::text)::int as val FROM app_config WHERE key = 'idle_session_timeout_minutes'"
    );
    const n = rows[0]?.val;
    return typeof n === "number" && n > 0 ? n : IDLE_TIMEOUT_MIN;
  } catch {
    return IDLE_TIMEOUT_MIN;
  }
}

export async function createSession(userId: string): Promise<string> {
  const timeoutMin = await getIdleTimeoutMinutes();
  const expiresAt = new Date(Date.now() + timeoutMin * 60 * 1000);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO sessions (user_id, expires_at)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, expiresAt]
  );
  const sessionId = rows[0]!.id;
  await query(
    "UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1",
    [userId]
  );
  return sessionId;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  const { rows } = await query<
    User & { session_id: string; expires_at: Date; revoked_at: string | null }
  >(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.must_change_password,
            u.is_platform_admin, u.status, s.id as session_id, s.expires_at, s.revoked_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.revoked_at IS NULL AND u.status = 'active'`,
    [sessionId]
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at) <= new Date()) {
    await revokeSession(sessionId);
    return null;
  }

  // Extend session on activity (sliding window)
  const timeoutMin = await getIdleTimeoutMinutes();
  const newExpires = new Date(Date.now() + timeoutMin * 60 * 1000);
  await query(
    "UPDATE sessions SET expires_at = $1, last_seen_at = now() WHERE id = $2",
    [newExpires, sessionId]
  );

  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    must_change_password: row.must_change_password,
    is_platform_admin: row.is_platform_admin,
    status: row.status,
    sessionId: row.session_id,
    expiresAt: newExpires,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [
    sessionId,
  ]);
}

export async function setSessionCookie(sessionId: string): Promise<void> {
  const timeoutMin = await getIdleTimeoutMinutes();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: timeoutMin * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSessionWarningMinutes(): Promise<number> {
  try {
    const { rows } = await query<{ val: number }>(
      "SELECT (value_json::text)::int as val FROM app_config WHERE key = 'session_warning_minutes'"
    );
    const n = rows[0]?.val;
    return typeof n === "number" && n > 0 ? n : WARNING_MIN;
  } catch {
    return WARNING_MIN;
  }
}

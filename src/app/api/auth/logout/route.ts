import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { query } from "@/lib/db";

const SESSION_COOKIE = "session_id";

export async function POST() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [
      sessionId,
    ]);
  }
  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ success: true });
}

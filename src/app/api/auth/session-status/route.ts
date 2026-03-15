import { NextResponse } from "next/server";
import { getSessionUser, getSessionWarningMinutes } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const warningMin = await getSessionWarningMinutes();
  const remainingMs = user.expiresAt.getTime() - Date.now();
  const remainingMinutes = Math.floor(remainingMs / 60_000);
  return NextResponse.json({
    authenticated: true,
    remainingMinutes,
    warningMinutes: warningMin,
    showWarning: remainingMinutes <= warningMin,
  });
}

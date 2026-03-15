import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    must_change_password: user.must_change_password,
    is_platform_admin: user.is_platform_admin,
    status: user.status,
  });
}

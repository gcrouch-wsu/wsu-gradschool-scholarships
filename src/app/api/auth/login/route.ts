import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { verifyPassword, createSession, setSessionCookie } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;
    if (!email || !password || typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const { rows } = await query<{
      id: string;
      email: string;
      password_hash: string;
      status: string;
      must_change_password: boolean;
    }>(
      "SELECT id, email, password_hash, status, must_change_password FROM users WHERE LOWER(email) = LOWER($1)",
      [email.trim()]
    );
    const user = rows[0];
    if (!user || user.status !== "active") {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const sessionId = await createSession(user.id);
    await setSessionCookie(sessionId);

    return NextResponse.json({
      success: true,
      mustChangePassword: user.must_change_password,
    });
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    );
  }
}

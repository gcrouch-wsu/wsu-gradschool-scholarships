import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/logout", "/"];
const AUTH_API = "/api/auth";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get("session_id")?.value;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // API routes: auth endpoints are public; others need session
  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith(AUTH_API)) {
      return NextResponse.next();
    }
    // Other API routes require session - checked in route handlers
    return NextResponse.next();
  }

  // Page routes: redirect unauthenticated to login
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

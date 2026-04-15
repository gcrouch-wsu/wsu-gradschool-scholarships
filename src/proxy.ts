import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_API = "/api/auth";

/**
 * Document routes that must be reachable **without** a session cookie.
 * Do not use `pathname.startsWith("/")` — every path starts with "/" and would
 * bypass the login redirect for all pages.
 */
function isPublicDocumentPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname.startsWith("/submit/")) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get("session_id")?.value;

  if (isPublicDocumentPath(pathname)) {
    return NextResponse.next();
  }

  // API routes: auth endpoints are public; others need session — checked in route handlers
  if (pathname.startsWith("/api/")) {
    if (pathname.startsWith(AUTH_API)) {
      return NextResponse.next();
    }
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

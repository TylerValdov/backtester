// Route protection (Next 16 "proxy", formerly middleware).
//
// Optimistic check only: presence of the session cookie gates the app shell;
// the backend validates the JWT on every API call. Signed-out users land on
// /login with a return path.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED = ["/dashboard", "/build", "/strategies", "/backtests", "/analytics", "/settings"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const session = request.cookies.get("session")?.value;
  if (!session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/build/:path*", "/strategies/:path*", "/backtests/:path*", "/analytics/:path*", "/settings/:path*"],
};

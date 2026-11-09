import { authMiddleware } from "@/lib/auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Only apply auth to API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  // No Authorization header: let the route handler decide.
  // RLS will fail closed if tenant context is missing.
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};

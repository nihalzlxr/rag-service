import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { lookupApiKey } from "./api-keys";

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns the token string or null if missing/malformed.
 */
function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") return null;
  return parts[1];
}

/**
 * Auth middleware for API routes.
 * Validates API keys, sets x-tenant-id and x-roles headers on success.
 * Returns a 401 Response if the key is missing, invalid, or revoked.
 * Returns null if no Authorization header is present (let downstream
 * handle it — RLS will fail closed).
 */
export async function authMiddleware(
  request: NextRequest
): Promise<Response | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const credentials = await lookupApiKey(token);
  if (!credentials) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const response = NextResponse.next();
  response.headers.set("x-tenant-id", credentials.tenantId);
  response.headers.set("x-roles", credentials.roles.join(","));
  return response;
}

import { createHash } from "crypto";
import { db } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export type ApiKeyCredentials = {
  tenantId: string;
  roles: string[];
};

/**
 * Look up an API key by its SHA-256 hash.
 * Returns { tenantId, roles } if the key is valid and not revoked,
 * otherwise returns null.
 */
export async function lookupApiKey(
  key: string
): Promise<ApiKeyCredentials | null> {
  const keyHash = createHash("sha256").update(key).digest("hex");

  const result = await db
    .select({
      tenantId: apiKeys.tenantId,
      roles: apiKeys.roles,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.keyHash, keyHash),
        isNull(apiKeys.revokedAt)
      )
    )
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  return {
    tenantId: result[0].tenantId,
    roles: result[0].roles,
  };
}

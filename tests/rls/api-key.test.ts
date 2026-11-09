import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db/client";
import { withRLS } from "@/lib/db/rls";
import { lookupApiKey } from "@/lib/auth/api-keys";
import { tenants, apiKeys } from "@/lib/db/schema";
import { createHash } from "crypto";

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

const TENANT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const VALID_KEY = "sk-valid-key-for-testing";
const REVOKED_KEY = "sk-revoked-key-for-testing";

describe("API key lookup", () => {
  beforeAll(async () => {
    // Clean up any existing data from previous runs
    await db.delete(apiKeys);
    await db.delete(tenants);

    // Create tenant (no RSL on tenants table)
    await db.insert(tenants).values({
      id: TENANT_ID,
      name: "Test Tenant",
    });

    // Insert valid API key using withRLS (FORCE RLS requires tenant context)
    const validHash = sha256(VALID_KEY);
    await withRLS(TENANT_ID, ["public", "admin"], async (tx) => {
      await tx.insert(apiKeys).values({
        id: "66666666-6666-6666-6666-666666666666",
        keyHash: validHash,
        tenantId: TENANT_ID,
        roles: ["public", "admin"],
        name: "Test Valid Key",
      });
    });

    // Insert revoked API key
    const revokedHash = sha256(REVOKED_KEY);
    await withRLS(TENANT_ID, ["public"], async (tx) => {
      await tx.insert(apiKeys).values({
        id: "77777777-7777-7777-7777-777777777777",
        keyHash: revokedHash,
        tenantId: TENANT_ID,
        roles: ["public"],
        name: "Test Revoked Key",
        revokedAt: new Date(),
      });
    });
  });

  afterAll(async () => {
    await db.delete(apiKeys);
    await db.delete(tenants);
  });

  it("valid API key returns tenantId and roles", async () => {
    const result = await lookupApiKey(VALID_KEY);
    expect(result).not.toBeNull();
    expect(result!.tenantId).toBe(TENANT_ID);
    expect(result!.roles).toContain("public");
    expect(result!.roles).toContain("admin");
  });

  it("invalid API key returns null", async () => {
    const result = await lookupApiKey("sk-invalid-key");
    expect(result).toBeNull();
  });

  it("revoked API key returns null", async () => {
    const result = await lookupApiKey(REVOKED_KEY);
    expect(result).toBeNull();
  });

  it("empty string key returns null", async () => {
    const result = await lookupApiKey("");
    expect(result).toBeNull();
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, appDb } from "@/lib/db/client";
import { withRLS } from "@/lib/db/rls";
import { documents, tenants } from "@/lib/db/schema";
import { sql, eq } from "drizzle-orm";

const TENANT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("withRLS helper", () => {
  beforeAll(async () => {
    await db.insert(tenants).values({ id: TENANT_ID, name: "Test Tenant" });
    await db.insert(documents).values({
      id: "11111111-1111-1111-1111-111111111111",
      tenantId: TENANT_ID,
      title: "Test Doc",
      content: "Test content",
    });
  });

  afterAll(async () => {
    await db.delete(documents);
    await db.delete(tenants);
  });

  it("sets app.current_tenant and app.current_roles inside transaction", async () => {
    let tenantInside: string | null = null;
    let rolesInside: string[] | null = null;

    await withRLS(TENANT_ID, ["public", "admin"], async (tx) => {
      const tenantResult = await tx.execute(sql`
        SELECT current_setting('app.current_tenant') AS tenant
      `);
      tenantInside = (tenantResult.rows[0] as any).tenant;

      const rolesResult = await tx.execute(sql`
        SELECT current_setting('app.current_roles') AS roles
      `);
      rolesInside = (rolesResult.rows[0] as any).roles;
    });

    expect(tenantInside).toBe(TENANT_ID);
    expect(rolesInside).toBe("{\"public\",\"admin\"}");
  });

  it("settings are not leaked outside the transaction", async () => {
    await withRLS(TENANT_ID, ["public"], async (tx) => {
      // inside transaction, settings are set
      const result = await tx.execute(sql`
        SELECT current_setting('app.current_tenant') AS tenant
      `);
      expect((result.rows[0] as any).tenant).toBe(TENANT_ID);
    });

    // After transaction completes, settings should be reset
    // Querying without settings should return 0 rows (fail closed)
    const rows = await appDb.select().from(documents);
    expect(rows.length).toBe(0);
  });

  it("settings are not leaked across withRLS calls", async () => {
    // First call with tenant A
    await withRLS(TENANT_ID, ["public"], async (tx) => {
      const result = await tx.execute(sql`
        SELECT current_setting('app.current_tenant') AS tenant
      `);
      expect((result.rows[0] as any).tenant).toBe(TENANT_ID);
    });

    // Second call — settings should be fresh, not leaked from first call
    const rows = await appDb.select().from(documents);
    expect(rows.length).toBe(0);
  });

  it("rolls back transaction on error", async () => {
    try {
      await withRLS(TENANT_ID, ["public"], async (tx) => {
        // Insert a document that will succeed inside transaction
        await tx.insert(documents).values({
          id: "99999999-9999-9999-9999-999999999999",
          tenantId: TENANT_ID,
          title: "Should Be Rolled Back",
          content: "Rollback test",
        });
        // Then throw
        throw new Error("Simulated error");
      });
    } catch {
      // Expected
    }

    // The rolled-back document should not exist
    const rows = await withRLS(TENANT_ID, ["public"], async (tx) => {
      return await tx
        .select()
        .from(documents)
        .where(eq(documents.title, "Should Be Rolled Back"));
    });
    expect(rows.length).toBe(0);
  });

  it("throws when tenantId is missing", async () => {
    await expect(
      withRLS("", ["public"], async (tx) => {
        return await tx.select().from(documents);
      })
    ).rejects.toThrow(/tenantId/);
  });

  it("throws when roles is missing", async () => {
    await expect(
      withRLS(TENANT_ID, [], async (tx) => {
        return await tx.select().from(documents);
      })
    ).rejects.toThrow(/roles/);
  });

  it("throws when roles is undefined", async () => {
    await expect(
      withRLS(TENANT_ID, undefined as unknown as string[], async (tx) => {
        return await tx.select().from(documents);
      })
    ).rejects.toThrow(/roles/);
  });
});

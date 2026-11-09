import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, appDb } from "@/lib/db/client";
import { withRLS } from "@/lib/db/rls";
import { documents, chunks, tenants } from "@/lib/db/schema";

const TENANT_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("RLS isolation", () => {
  beforeAll(async () => {
    // Clean up any existing data from previous runs (superuser, no RLS needed for delete)
    await db.delete(chunks);
    await db.delete(documents);
    await db.delete(tenants);

    // Create tenants (no RLS on tenants table)
    await db.insert(tenants).values([
      { id: TENANT_A_ID, name: "Tenant A" },
      { id: TENANT_B_ID, name: "Tenant B" },
    ]);

    // Insert documents for each tenant using withRLS (FORCE RLS requires tenant context)
    await withRLS(TENANT_A_ID, ["public"], async (tx) => {
      await tx.insert(documents).values({
        id: "11111111-1111-1111-1111-111111111111",
        tenantId: TENANT_A_ID,
        title: "Doc A",
        content: "Content A",
      });
    });
    await withRLS(TENANT_B_ID, ["public"], async (tx) => {
      await tx.insert(documents).values({
        id: "22222222-2222-2222-2222-222222222222",
        tenantId: TENANT_B_ID,
        title: "Doc B",
        content: "Content B",
      });
    });

    // Create chunks for each tenant using withRLS (FORCE RLS requires tenant context)
    // Insert public chunks with public roles
    await withRLS(TENANT_A_ID, ["public"], async (tx) => {
      await tx.insert(chunks).values([
        {
          id: "33333333-3333-3333-3333-333333333333",
          documentId: "11111111-1111-1111-1111-111111111111",
          tenantId: TENANT_A_ID,
          content: "Chunk A1 public",
          chunkIndex: 0,
          allowedRoles: ["public"],
        },
      ]);
    });
    // Insert admin-only chunk with admin roles (RLS requires roles to match)
    await withRLS(TENANT_A_ID, ["admin"], async (tx) => {
      await tx.insert(chunks).values([
        {
          id: "55555555-5555-5555-5555-555555555555",
          documentId: "11111111-1111-1111-1111-111111111111",
          tenantId: TENANT_A_ID,
          content: "Chunk A2 admin-only",
          chunkIndex: 1,
          allowedRoles: ["admin"],
        },
      ]);
    });
    await withRLS(TENANT_B_ID, ["public"], async (tx) => {
      await tx.insert(chunks).values([
        {
          id: "44444444-4444-4444-4444-444444444444",
          documentId: "22222222-2222-2222-2222-222222222222",
          tenantId: TENANT_B_ID,
          content: "Chunk B1 public",
          chunkIndex: 0,
          allowedRoles: ["public"],
        },
      ]);
    });
  });

  afterAll(async () => {
    await db.delete(chunks);
    await db.delete(documents);
    await db.delete(tenants);
  });

  it("tenant A sees only tenant A's documents", async () => {
    const rows = await withRLS(TENANT_A_ID, ["public"], async (tx) => {
      return await tx.select().from(documents);
    });
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Doc A");
  });

  it("tenant B sees only tenant B's documents", async () => {
    const rows = await withRLS(TENANT_B_ID, ["public"], async (tx) => {
      return await tx.select().from(documents);
    });
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Doc B");
  });

  it("chunks respect tenant_id isolation", async () => {
    const rows = await withRLS(TENANT_A_ID, ["public", "admin"], async (tx) => {
      return await tx.select().from(chunks);
    });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.tenantId === TENANT_A_ID)).toBe(true);
  });

  it("chunks respect allowed_roles: public role sees public chunks only", async () => {
    const rows = await withRLS(TENANT_A_ID, ["public"], async (tx) => {
      return await tx.select().from(chunks);
    });
    // Tenant A has 2 chunks: one public, one admin-only
    // With roles=['public'], only the public chunk should be visible
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe("Chunk A1 public");
  });

  it("chunks respect allowed_roles: admin role sees admin chunks", async () => {
    const rows = await withRLS(TENANT_A_ID, ["admin"], async (tx) => {
      return await tx.select().from(chunks);
    });
    // With roles=['admin'], the admin-only chunk is visible
    expect(rows.length).toBe(1);
    expect(rows[0].content).toBe("Chunk A2 admin-only");
  });

  it("query as rag_app without tenant settings returns zero rows (fail closed)", async () => {
    // Direct query via appDb (rag_app role) without SET LOCAL
    // FORCE RLS means even without settings, rag_app sees 0 rows
    const rows = await appDb.select().from(documents);
    expect(rows.length).toBe(0);
  });

  it("query as rag_app without roles setting returns zero rows for chunks", async () => {
    // Without any settings, current_setting returns NULL/empty, so
    // tenant_id::text = '' is never true → 0 rows (fail closed)
    const rows = await appDb.select().from(chunks);
    expect(rows.length).toBe(0);
  });
});

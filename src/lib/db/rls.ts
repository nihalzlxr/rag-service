import { appDb } from "./client";
import type { DB } from "./client";
import { sql } from "drizzle-orm";

type Tx = Omit<DB, "$client">;

/**
 * Runs `fn` inside a transaction with `SET LOCAL app.current_tenant` and
 * `SET LOCAL app.current_roles` configured.
 *
 * Uses the `rag_app` (non-superuser) pool so RLS policies are enforced —
 * superuser connections bypass RLS even with FORCE ROW LEVEL SECURITY.
 *
 * Fail-closed: throws if `tenantId` or `roles` is missing before any query.
 * `SET LOCAL` is transaction-scoped — automatically reset on commit/rollback,
 * preventing settings from leaking across requests in a connection pool.
 *
 * All queries inside `fn` must use the provided `tx` (not the global `db`),
 * so they run under the same transaction and RLS settings.
 */
export async function withRLS<T>(
  tenantId: string,
  roles: string[],
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  if (!tenantId) {
    throw new Error("withRLS: tenantId is required (fail-closed)");
  }
  if (!roles || roles.length === 0) {
    throw new Error("withRLS: roles is required (fail-closed)");
  }

  return await appDb.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.current_tenant = ${tenantId}`);
    await tx.execute(sql`SET LOCAL app.current_roles = ${roles}`);
    return await fn(tx);
  });
}

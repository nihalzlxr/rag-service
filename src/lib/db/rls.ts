import { appDb } from "./client";
import type { DB } from "./client";
import { sql } from "drizzle-orm";

type Tx = Omit<DB, "$client">;

function formatRolesArray(roles: string[]): string {
  return `{${roles.map((r) => `"${r}"`).join(",")}}`;
}

/**
 * Runs `fn` inside a transaction with `SET LOCAL app.current_tenant` and
 * `SET LOCAL app.current_roles` configured.
 *
 * Uses the `rag_app` (non-superuser) pool so RLS policies are enforced —
 * superuser connections bypass RLS even with FORCE ROW LEVEL SECURITY.
 *
 * Uses `set_config(name, value, true)` instead of `SET LOCAL` because
 * PostgreSQL's `SET` command doesn't support parameterized queries.
 * `set_config(..., true)` sets is_local=true, which is equivalent to SET LOCAL
 * — automatically reset on commit/rollback.
 *
 * Fail-closed: throws if `tenantId` or `roles` is missing before any query.
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

  const rolesLiteral = formatRolesArray(roles);

  return await appDb.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    await tx.execute(sql`SELECT set_config('app.current_roles', ${rolesLiteral}, true)`);
    return await fn(tx);
  });
}

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // connection pool size
});

export const db = drizzle(pool, { schema });

export type DB = typeof db;

/**
 * Creates a separate connection pool using `rag_app` credentials (non-superuser).
 * The `rag_app` role is subject to RLS policies, so queries through this pool
 * are automatically tenant-isolated when `SET LOCAL` is used inside a transaction.
 *
 * Uses DATABASE_URL_RLS if set; otherwise derives from DATABASE_URL by replacing
 * the user/password with `rag_app` credentials.
 */
export function createAppPool() {
  const rlsUrl =
    process.env.DATABASE_URL_RLS ||
    process.env.DATABASE_URL?.replace(
      /:\/\/[^@]+@/,
      "://rag_app:rag_app_password@"
    );

  if (!rlsUrl) {
    throw new Error("createAppPool: no RLS database URL configured");
  }

  const rlsPool = new Pool({
    connectionString: rlsUrl,
    max: 10,
  });

  return drizzle(rlsPool, { schema });
}

export type AppDB = ReturnType<typeof createAppPool>;

export const appDb = createAppPool();
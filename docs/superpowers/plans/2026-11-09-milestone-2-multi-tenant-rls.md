# Milestone 2: Multi-Tenant Schema, Authentication, RLS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the RAG service database schema with multi-tenancy (tenant_id, allowed_roles), add tenants and api_keys tables, enforce Row-Level Security with a non-superuser `rag_app` role using `SET LOCAL` inside transactions, add API-key authentication middleware, and automate RLS tests in CI. Fail-closed: queries without tenant settings return zero rows.

**Architecture:** Schema-first approach. All new tables added via Drizzle schema + SQL migration. RLS enforced at the PostgreSQL level with FORCE ROW LEVEL SECURITY. A `withRLS()` helper wraps queries in transactions with `SET LOCAL app.current_tenant` and `SET LOCAL app.current_roles`. Next.js middleware validates API keys and passes tenant context via headers.

**Tech Stack:** PostgreSQL 16 + pgvector 0.8.5, Drizzle ORM, Next.js 15 (App Router middleware), TypeScript, Vitest + Testcontainers/Compose Postgres, GitHub Actions CI.

**Spec:** `docs/implementation-plan.md` (Milestone 2 sections 2.1–2.4 + Acceptance Criteria + ADR 002)

## Global Constraints

- pgvector 0.8.5 supports RLS on vector tables (documented in ADR 002 evidence).
- `FORCE ROW LEVEL SECURITY` ensures superuser queries also respect policies.
- `SET LOCAL` is transaction-scoped and automatically reset on commit/rollback.
- `withRLS(tenantId, roles, fn)` throws if `tenantId` or `roles` missing (fail closed).
- `allowed_roles` on chunks defaults to `'{public}'`.
- `api_keys.key_hash` stores sha256 of the key.
- All pure-function tests (chunking, metrics) pass without Docker; RLS tests require real Postgres.

## Review Focus

1. **Missing tenantId or roles in `withRLS`** — must throw before any query (fail closed).
2. **Settings leaking across calls** — `SET LOCAL` inside transaction must not persist between requests.
3. **Cross-tenant data access** — querying as tenant A must return zero rows for tenant B's data.
4. **Revoked/invalid API keys** — must return 401, never authorize.
5. **`public` role table access** — all table access revoked from `public`, only `rag_app` has grants.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/db/schema.ts` | Add tenant_id to documents/chunks, allowed_roles to chunks; create tenants, api_keys, events tables |
| `drizzle/0001_multi_tenant.sql` | Migration: add columns, create tables, indexes, RLS policies, grants, rag_app role |
| `src/lib/auth/api-keys.ts` | Lookup API key, verify sha256 hash, return `{ tenantId, roles }` |
| `src/lib/auth/middleware.ts` | Next.js middleware extracts `Authorization: Bearer <key>`, validates, sets `x-tenant-id`, `x-roles` headers |
| `src/lib/db/rls.ts` | `withRLS<T>(tenantId, roles, fn)` — runs fn inside transaction with SET LOCAL settings |
| `src/lib/db/client.ts` | Add `createAppPool()` using `rag_app` credentials separate from migration pool |
| `tests/rls/rls.test.ts` | Cross-tenant isolation, fail-closed without settings, role mismatch |
| `tests/rls/api-key.test.ts` | Valid/invalid/revoked key behavior, missing header |
| `tests/rls/withRLS.test.ts` | withRLS sets settings, rolls back on error, no leakage across calls |
| `.github/workflows/rls-tests.yml` | CI: spins up Compose Postgres, runs `pnpm test:rls` |
| `package.json` | Add `test:rls` script |

---

### Task 1: Schema — Add tenant_id to documents & chunks

**Files:**
- Modify: `src/lib/db/schema.ts`
- Test: none (covered by migration tests in Task 6)

**Interfaces:**
- Consumes: existing `documents` and `chunks` table definitions
- Produces: `documents.tenant_id` (UUID, not null), `chunks.tenant_id` (UUID, not null, FK → documents)

- [ ] **Step 1: Add `tenant_id` to `documents` table** in `src/lib/db/schema.ts`
  ```ts
  tenant_id: uuid("tenant_id").notNull(),
  ```
  Place after `content` field, before `metadata`. Also add index on `tenant_id`.

- [ ] **Step 2: Add `tenant_id` to `chunks` table** in `src/lib/db/schema.ts`
  ```ts
  tenant_id: uuid("tenant_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  ```
  Place after `documentId`. Also add index on `tenant_id`.

- [ ] **Step 3: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/db/schema.ts
  git commit -m "feat(milestone-2): add tenant_id to documents and chunks schema"
  ```

---

### Task 2: Schema — Add allowed_roles to chunks

**Files:**
- Modify: `src/lib/db/schema.ts`

**Interfaces:**
- Consumes: `chunks` table from Task 1
- Produces: `chunks.allowed_roles` (TEXT[], default `'{public}'`)

- [ ] **Step 1: Add `allowed_roles` field to `chunks` table** in `src/lib/db/schema.ts`
  ```ts
  allowed_roles: text("allowed_roles").array().default(["public"]).notNull(),
  ```

- [ ] **Step 2: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/db/schema.ts
  git commit -m "feat(milestone-2): add allowed_roles to chunks schema"
  ```

---

### Task 3: Schema — Create tenants table

**Files:**
- Modify: `src/lib/db/schema.ts`

**Interfaces:**
- Consumes: none (new standalone table)
- Produces: `tenants` table with `id` (UUID PK), `name` (text), `created_at` (timestamp)

- [ ] **Step 1: Define `tenants` table** in `src/lib/db/schema.ts`
  ```ts
  export const tenants = pgTable("tenants", {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  });
  ```
  Export types `Tenant` and `NewTenant`.

- [ ] **Step 2: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/db/schema.ts
  git commit -m "feat(milestone-2): add tenants table schema"
  ```

---

### Task 4: Schema — Create api_keys table

**Files:**
- Modify: `src/lib/db/schema.ts`

**Interfaces:**
- Consumes: `tenants` table from Task 3
- Produces: `api_keys` table with `id`, `key_hash` (sha256), `tenant_id` (FK → tenants), `roles` (TEXT[]), `name`, `created_at`, `revoked_at`

- [ ] **Step 1: Define `api_keys` table** in `src/lib/db/schema.ts`
  ```ts
  export const apiKeys = pgTable("api_keys", {
    id: uuid("id").defaultRandom().primaryKey(),
    keyHash: text("key_hash").notNull(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    roles: text("roles").array().default(["public"]).notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
  });
  ```
  Export types `ApiKey` and `NewApiKey`.

- [ ] **Step 2: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/db/schema.ts
  git commit -m "feat(milestone-2): add api_keys table schema"
  ```

---

### Task 5: Schema — Create events table for observability

**Files:**
- Modify: `src/lib/db/schema.ts`

**Interfaces:**
- Consumes: none (standalone, references tenants via tenant_id but no FK for simplicity)
- Produces: `events` table with `id`, `type` (text), `tenant_id` (UUID), `payload` (jsonb), `created_at` (timestamp)

- [ ] **Step 1: Define `events` table** in `src/lib/db/schema.ts`
  ```ts
  export const events = pgTable("events", {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    payload: jsonb("payload").default({}).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  });
  ```
  Export types `Event` and `NewEvent`.

- [ ] **Step 2: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/db/schema.ts
  git commit -m "feat(milestone-2): add events table schema"
  ```

---

### Task 6: Migration SQL — Drop HNSW, add tenant/role indexes, create tables, RLS

**Files:**
- Create: `drizzle/0001_multi_tenant.sql`

**Interfaces:**
- Consumes: schema from Tasks 1–5 (Drizzle definition)
- Produces: SQL migration applied via `pnpm db:migrate`

- [ ] **Step 1: Drop HNSW index from chunks** (exact search first; HNSW logged as experiment)
  ```sql
  DROP INDEX IF EXISTS chunks_embedding_idx;
  ```

- [ ] **Step 2: Add columns to existing tables**
  ```sql
  ALTER TABLE "documents" ADD COLUMN "tenant_id" uuid NOT NULL;
  ALTER TABLE "chunks" ADD COLUMN "tenant_id" uuid NOT NULL;
  ALTER TABLE "chunks" ADD COLUMN "allowed_roles" text[] DEFAULT ARRAY['public']::text[] NOT NULL;
  ```

- [ ] **Step 3: Create tenants table**
  ```sql
  CREATE TABLE "tenants" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  ```

- [ ] **Step 4: Create api_keys table**
  ```sql
  CREATE TABLE "api_keys" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "key_hash" text NOT NULL,
    "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
    "roles" text[] DEFAULT ARRAY['public']::text[] NOT NULL,
    "name" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "revoked_at" timestamp
  );
  ```

- [ ] **Step 5: Create events table**
  ```sql
  CREATE TABLE "events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "type" text NOT NULL,
    "tenant_id" uuid NOT NULL,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
  );
  ```

- [ ] **Step 6: Add foreign keys and indexes**
  ```sql
  ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
  ALTER TABLE "chunks" ADD CONSTRAINT "chunks_tenant_id_documents_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "documents"("id") ON DELETE cascade;
  CREATE INDEX "documents_tenant_id_idx" ON "documents" USING btree ("tenant_id");
  CREATE INDEX "chunks_tenant_id_idx" ON "chunks" USING btree ("tenant_id");
  CREATE INDEX "chunks_tenant_id_embedding_idx" ON "chunks" USING btree ("tenant_id");
  CREATE INDEX "chunks_allowed_roles_idx" ON "chunks" USING gin ("allowed_roles");
  CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys" USING btree ("tenant_id");
  CREATE INDEX "events_tenant_id_idx" ON "events" USING btree ("tenant_id");
  ```

- [ ] **Step 7: Verify migration applies cleanly**
  Run: `pnpm db:migrate`
  Expected: Success, all tables and indexes created

- [ ] **Step 8: Commit**
  ```bash
  git add drizzle/0001_multi_tenant.sql
  git commit -m "feat(milestone-2): migration for multi-tenant schema, indexes, api_keys, tenants, events"
  ```

---

### Task 7: RLS Policies — Create rag_app role, enable RLS, write policies

**Files:**
- Modify: `drizzle/0001_multi_tenant.sql` (append RLS section)

**Interfaces:**
- Consumes: tables from Task 6 migration
- Produces: `rag_app` role, RLS policies on documents/chunks/api_keys/events, FORCE RLS enabled

- [ ] **Step 1: Create rag_app role with login**
  ```sql
  CREATE ROLE rag_app LOGIN;
  ALTER ROLE rag_app WITH PASSWORD 'rag_app_password';
  ```

- [ ] **Step 2: Grant table permissions to rag_app**
  ```sql
  GRANT SELECT, INSERT, UPDATE ON documents, chunks, api_keys, events TO rag_app;
  GRANT USAGE ON SCHEMA public TO rag_app;
  ```

- [ ] **Step 3: Revoke all from public**
  ```sql
  REVOKE ALL ON documents, chunks, api_keys, events FROM public;
  ```

- [ ] **Step 4: Enable RLS on documents and chunks**
  ```sql
  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE documents FORCE ROW LEVEL SECURITY;
  ALTER TABLE chunks FORCE ROW LEVEL SECURITY;
  ```

- [ ] **Step 5: RLS policy: tenant_id on documents**
  ```sql
  CREATE POLICY documents_tenant_isolation ON documents
    FOR ALL TO rag_app
    USING (tenant_id = current_setting('app.current_tenant', true));
  ```

- [ ] **Step 6: RLS policy: tenant_id on chunks**
  ```sql
  CREATE POLICY chunks_tenant_isolation ON chunks
    FOR ALL TO rag_app
    USING (tenant_id = current_setting('app.current_tenant', true));
  ```

- [ ] **Step 7: RLS policy: allowed_roles on chunks**
  ```sql
  CREATE POLICY chunks_role_isolation ON chunks
    FOR ALL TO rag_app
    USING (allowed_roles && current_setting('app.current_roles', true)::text[]);
  ```

- [ ] **Step 8: RLS policy: tenant_id on api_keys**
  ```sql
  CREATE POLICY api_keys_tenant_isolation ON api_keys
    FOR ALL TO rag_app
    USING (tenant_id = current_setting('app.current_tenant', true));
  ```

- [ ] **Step 9: Verify RLS is active**
  Run:
  ```bash
  docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
    SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('documents','chunks');
  "
  ```
  Expected: `relrowsecurity=t`, `relforcerowsecurity=t` for both tables

- [ ] **Step 10: Commit**
  ```bash
  git add drizzle/0001_multi_tenant.sql
  git commit -m "feat(milestone-2): RLS policies, rag_app role, FORCE RLS on documents and chunks"
  ```

---

### Task 8: Auth — Create api-keys.ts lookup module

**Files:**
- Create: `src/lib/auth/api-keys.ts`

**Interfaces:**
- Consumes: `db` from `src/lib/db/client.ts`, `apiKeys` schema table
- Produces: function `lookupApiKey(key: string): Promise<{ tenantId: string; roles: string[] } | null>`

- [ ] **Step 1: Implement `lookupApiKey`** in `src/lib/auth/api-keys.ts`
  - Hash incoming key with sha256 (use Node crypto)
  - Query `api_keys` table where `key_hash` = hash and `revoked_at` IS NULL
  - Return `{ tenantId, roles }` if found, `null` if not found or revoked

- [ ] **Step 2: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 3: Commit**
  ```bash
  git add src/lib/auth/api-keys.ts
  git commit -m "feat(milestone-2): api-keys lookup module with sha256 hash verification"
  ```

---

### Task 9: Auth — Create Next.js middleware for API key validation

**Files:**
- Create: `src/lib/auth/middleware.ts`
- Create: `src/middleware.ts` (Next.js middleware entry)

**Interfaces:**
- Consumes: `lookupApiKey` from `src/lib/auth/api-keys.ts`
- Produces: middleware that extracts `Authorization: Bearer <key>`, validates, sets `x-tenant-id` and `x-roles` headers, returns 401 for invalid/missing keys

- [ ] **Step 1: Implement auth middleware** in `src/lib/auth/middleware.ts`
  - Export function `authMiddleware(request: Request): Response | null`
  - Returns `null` if no `Authorization` header (let Next.js continue without tenant context — but RLS will fail closed)
  - Returns `null` if key is valid (sets headers via `NextResponse.next()`)
  - Returns 401 Response if key invalid/revoked

- [ ] **Step 2: Create Next.js middleware entry** in `src/middleware.ts`
  - Import and call `authMiddleware`
  - Apply to `/api/*` routes only

- [ ] **Step 3: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/auth/middleware.ts src/middleware.ts
  git commit -m "feat(milestone-2): API key auth middleware with x-tenant-id and x-roles headers"
  ```

---

### Task 10: DB — Create withRLS helper and createAppPool

**Files:**
- Create: `src/lib/db/rls.ts`
- Modify: `src/lib/db/client.ts`

**Interfaces:**
- Consumes: `db` pool from `src/lib/db/client.ts`, `tenantId` (string), `roles` (string[])
- Produces: `withRLS<T>(tenantId, roles, fn): Promise<T>` — runs fn inside transaction with SET LOCAL settings, throws if missing settings

- [ ] **Step 1: Add `createAppPool()` to client.ts**
  - Export function that creates a Pool using `rag_app` credentials (DATABASE_URL_RLS env var or derived from DATABASE_URL)
  - Used by auth middleware and withRLS for app-level queries

- [ ] **Step 2: Implement `withRLS`** in `src/lib/db/rls.ts`
  ```ts
  export async function withRLS<T>(tenantId: string, roles: string[], fn: (tx: typeof db) => Promise<T>): Promise<T> {
    if (!tenantId || !roles) throw new Error("tenantId and roles required");
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.current_tenant = ${tenantId}`);
      await tx.execute(sql`SET LOCAL app.current_roles = ${roles}`);
      return await fn(tx);
    });
  }
  ```
  - Throws if settings missing (fail closed)
  - `SET LOCAL` scoped to transaction, auto-reset on commit/rollback

- [ ] **Step 3: Verify TypeScript compiles**
  Run: `pnpm exec tsc --noEmit`
  Expected: No errors

- [ ] **Step 4: Commit**
  ```bash
  git add src/lib/db/rls.ts src/lib/db/client.ts
  git commit -m "feat(milestone-2): withRLS helper and createAppPool for RLS-enforced queries"
  ```

---

### Task 11: Tests — RLS isolation tests (cross-tenant, fail-closed, role mismatch)

**Files:**
- Create: `tests/rls/rls.test.ts`

**Interfaces:**
- Consumes: real Postgres (Compose/Docker), `db` pool, `withRLS`
- Produces: test assertions that tenant A cannot see tenant B's data, queries without settings return 0 rows, mismatched roles return 0 rows

- [ ] **Step 1: Write RLS isolation test** in `tests/rls/rls.test.ts`
  ```ts
  test("tenant A sees only tenant A's documents", async () => {
    // insert doc for tenant A and tenant B
    // withRLS(tenantA, ["public"], () => SELECT * FROM documents) → only A's doc
    // withRLS(tenantB, ["public"], () => SELECT * FROM documents) → only B's doc
  });

  test("query without tenant settings returns zero rows (fail closed)", async () => {
    // SELECT * FROM documents without SET LOCAL → 0 rows
  });

  test("query with mismatched roles returns zero rows", async () => {
    // chunk with allowed_roles=['admin'], query with roles=['public'] → 0 rows
  });
  ```

- [ ] **Step 2: Add `test:rls` script to package.json**
  ```json
  "test:rls": "vitest run tests/rls/"
  ```

- [ ] **Step 3: Run tests**
  Run: `pnpm test:rls`
  Expected: All tests pass against Compose Postgres

- [ ] **Step 4: Commit**
  ```bash
  git add tests/rls/rls.test.ts package.json
  git commit -m "test(milestone-2): RLS isolation tests for cross-tenant and fail-closed"
  ```

---

### Task 12: Tests — API key validation tests

**Files:**
- Create: `tests/rls/api-key.test.ts`

**Interfaces:**
- Consumes: `lookupApiKey` from `src/lib/auth/api-keys.ts`
- Produces: assertions for valid key returns tenant/roles, invalid key throws/null, revoked key throws/null, missing header throws

- [ ] **Step 1: Write API key tests**
  ```ts
  test("valid API key returns tenantId and roles", ...);
  test("invalid API key returns null", ...);
  test("revoked API key returns null", ...);
  test("missing header throws", ...);
  ```

- [ ] **Step 2: Run tests**
  Run: `pnpm test:rls`
  Expected: All tests pass

- [ ] **Step 3: Commit**
  ```bash
  git add tests/rls/api-key.test.ts
  git commit -m "test(milestone-2): API key validation tests"
  ```

---

### Task 13: Tests — withRLS helper tests (transaction scoping, no leakage)

**Files:**
- Create: `tests/rls/withRLS.test.ts`

**Interfaces:**
- Consumes: `withRLS` from `src/lib/db/rls.ts`
- Produces: assertions that settings are scoped to transaction, rollback on error, no cross-call leakage

- [ ] **Step 1: Write withRLS tests**
  ```ts
  test("withRLS sets app.current_tenant and app.current_roles inside transaction", ...);
  test("withRLS rolls back on error", ...);
  test("settings not leaked across withRLS calls", ...);
  test("withRLS throws when tenantId or roles missing", ...);
  ```

- [ ] **Step 2: Run tests**
  Run: `pnpm test:rls`
  Expected: All tests pass

- [ ] **Step 3: Commit**
  ```bash
  git add tests/rls/withRLS.test.ts
  git commit -m "test(milestone-2): withRLS transaction scoping and fail-closed tests"
  ```

---

### Task 14: CI — GitHub Actions workflow for RLS tests

**Files:**
- Create: `.github/workflows/rls-tests.yml`

**Interfaces:**
- Consumes: `pnpm test:rls` script, Compose Postgres
- Produces: CI workflow that spins up Postgres via Docker Compose, runs RLS tests

- [ ] **Step 1: Create GitHub Actions workflow**
  ```yaml
  name: RLS Tests
  on: [push, pull_request]
  jobs:
    rls-tests:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: pgvector/pgvector:pg16
          env: ...
          ports: ["5432:5432"]
      steps:
        - checkout
        - setup pnpm
        - install deps
        - start docker compose
        - run pnpm db:migrate
        - run pnpm test:rls
  ```

- [ ] **Step 2: Commit**
  ```bash
  git add .github/workflows/rls-tests.yml
  git commit -m "ci(milestone-2): GitHub Actions workflow for RLS tests"
  ```

---

### Task 15: Verify Milestone 2 acceptance criteria

**Files:**
- None (verification only)

**Interfaces:**
- Consumes: all code from Tasks 1–14
- Produces: confirmed Milestone 2 complete

- [ ] **Step 1: Apply migration**
  Run: `pnpm db:migrate`
  Expected: Clean success

- [ ] **Step 2: Verify schema & RLS**
  Run the verification commands from `docs/implementation-plan.md` section 2.4 (dockers exec psql queries)
  Expected: `rag_app` role exists with correct grants, `relrowsecurity=t`, `relforcerowsecurity=t`

- [ ] **Step 3: Run automated RLS tests**
  Run: `pnpm test:rls`
  Expected: All tests pass

- [ ] **Step 4: Update README.md**
  - Check off "Schema: documents, chunks (tenant_id, allowed_roles, embedding)" → add "API-key auth table, RLS with non-superuser app role, automated RLS tests in CI"
  - Add auth middleware box to architecture diagram
  - Mention `rag_app` role, `FORCE ROW LEVEL SECURITY`, Vitest + CI in tech stack

- [ ] **Step 5: Commit**
  ```bash
  git add README.md
  git commit -m "docs(milestone-2): update README with RLS status and architecture"
  ```

---

**Plan complete and saved to `docs/superpowers/plans/2026-11-09-milestone-2-multi-tenant-rls.md`.** 15 tasks with ~62 steps total.

The tasks are sequential — each builds on the previous one's interfaces (schema → migration → auth → RLS helper → tests → CI). I recommend **Native execution** (I implement every task myself in this session) because the plan carries the exact interfaces and signatures, and a fresh reviewer can check the whole branch at the end. Tasks 1–5 (schema) are independent of each other except for table references, but Tasks 6–15 depend on all earlier tasks completing first.

Please review the plan. Does it capture what you want, and should we proceed with Native execution?
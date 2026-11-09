-- Migration 0001: Multi-tenant schema, RLS, API keys, tenants, events

-- 1. Drop HNSW index from chunks (exact search baseline; HNSW logged as experiment)
DROP INDEX IF EXISTS chunks_embedding_idx;

-- 2. Add tenant_id to documents
ALTER TABLE "documents" ADD COLUMN "tenant_id" uuid NOT NULL;

-- 3. Add tenant_id and allowed_roles to chunks
ALTER TABLE "chunks" ADD COLUMN "tenant_id" uuid NOT NULL;
ALTER TABLE "chunks" ADD COLUMN "allowed_roles" text[] DEFAULT ARRAY['public']::text[] NOT NULL;

-- 4. Create tenants table
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- 5. Create api_keys table
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key_hash" text NOT NULL,
	"tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action,
	"roles" text[] DEFAULT ARRAY['public']::text[] NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);

-- 6. Create events table
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- 7. Foreign keys
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;

-- 8. Indexes
CREATE INDEX "documents_tenant_id_idx" ON "documents" USING btree ("tenant_id");
CREATE INDEX "chunks_tenant_id_idx" ON "chunks" USING btree ("tenant_id");
CREATE INDEX "chunks_tenant_id_embedding_idx" ON "chunks" USING btree ("tenant_id");
CREATE INDEX "chunks_allowed_roles_idx" ON "chunks" USING gin ("allowed_roles");
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys" USING btree ("tenant_id");
CREATE INDEX "events_tenant_id_idx" ON "events" USING btree ("tenant_id");
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");
CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");

-- 9. Create rag_app role (non-superuser app role)
CREATE ROLE rag_app LOGIN;
ALTER ROLE rag_app WITH PASSWORD 'rag_app_password';

-- 10. Grant table permissions to rag_app
GRANT USAGE ON SCHEMA public TO rag_app;
GRANT SELECT, INSERT, UPDATE ON documents, chunks, api_keys, events TO rag_app;

-- 11. Revoke all from public
REVOKE ALL ON documents, chunks, api_keys, events FROM public;

-- 12. Enable RLS on documents and chunks (FORCE = superusers also must follow policies)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
ALTER TABLE chunks FORCE ROW LEVEL SECURITY;

-- 13. RLS policies: tenant_id isolation on documents
-- Use ::text comparison (not ::uuid cast) because set_config(..., true) on
-- commit reverts to empty string "", which would fail ::uuid cast.
CREATE POLICY documents_tenant_isolation ON documents
    FOR ALL TO rag_app
    USING (tenant_id::text = current_setting('app.current_tenant', true));

-- 14. RLS policies: combined tenant + role isolation on chunks
-- Single policy with AND: PostgreSQL combines multiple policies with OR,
-- so we need one policy that checks both tenant and roles together.
CREATE POLICY chunks_isolation ON chunks
    FOR ALL TO rag_app
    USING (tenant_id::text = current_setting('app.current_tenant', true)
           AND allowed_roles && NULLIF(current_setting('app.current_roles', true), '')::text[]);

-- 15. RLS policies: tenant_id isolation on api_keys
CREATE POLICY api_keys_tenant_isolation ON api_keys
    FOR ALL TO rag_app
    USING (tenant_id::text = current_setting('app.current_tenant', true));

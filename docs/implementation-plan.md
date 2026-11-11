# Implementation Plan — RAG Service

**Status tracking**: `[ ]` = not started, `[~]` = in progress, `[x]` = done, `[!]` = blocked

---

## Milestone 1: Foundation ✅ DONE

| Task | Status | Verification |
|------|--------|--------------|
| Next.js 15 + TypeScript + Tailwind | [x] | `pnpm dev` starts |
| Docker Compose: Postgres 16 + pgvector 0.8.5, Redis 7 | [x] | `docker compose ps` → both healthy |
| Drizzle ORM + schema (documents, chunks) | [x] | `pnpm db:migrate` succeeds |
| pgvector extension enabled | [x] | `CREATE EXTENSION vector` runs |
| Health endpoint `/api/health` | [x] | `curl` → `{"db":"ok","redis":"ok"}` |
| README + ADR 001 + design.md | [x] | Files exist, pushed to GitHub |

---

## Milestone 2: Multi-Tenant Schema, Authentication, RLS & Automated RLS Tests

**Goal**: Extend schema with `tenant_id`, `allowed_roles`, API-key auth table, and enforce Row-Level Security with a non-superuser app role. All RLS tests run automatically in CI.

### 2.1 Schema Changes (Drizzle)

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Add `tenant_id` (UUID, not null) to `documents` | [ ] | `src/lib/db/schema.ts` |
| Add `allowed_roles` (TEXT[], default `'{public}'`) to `chunks` | [ ] | `src/lib/db/schema.ts` |
| Add `tenant_id` to `chunks` (FK → documents) | [ ] | `src/lib/db/schema.ts` |
| Create `api_keys` table: `id`, `key_hash` (sha256), `tenant_id`, `roles` (TEXT[]), `name`, `created_at`, `revoked_at` | [ ] | `src/lib/db/schema.ts` |
| Create `tenants` table: `id`, `name`, `created_at` | [ ] | `src/lib/db/schema.ts` |
| Drop HNSW index from chunks (exact search first; HNSW logged as experiment) | [ ] | Migration SQL |
| Create composite index `chunks(tenant_id, embedding)` for filtered exact search | [ ] | Migration SQL |
| Create GIN index on `chunks.tsv` for full-text search (English + simple config) | [ ] | Migration SQL |
| Create `events` table for observability: `id`, `type`, `tenant_id`, `payload` (jsonb), `created_at` | [ ] | `src/lib/db/schema.ts` |

### 2.2 RLS Policies (Migration SQL)

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Create non-superuser role `rag_app` with login | [ ] | Migration SQL |
| Grant `rag_app` SELECT/INSERT/UPDATE on `documents`, `chunks`, `api_keys`, `events` | [ ] | Migration SQL |
| `ALTER TABLE documents ENABLE ROW LEVEL SECURITY` | [ ] | Migration SQL |
| `ALTER TABLE chunks ENABLE ROW LEVEL SECURITY` | [ ] | Migration SQL |
| `ALTER TABLE documents FORCE ROW LEVEL SECURITY` | [ ] | Migration SQL |
| `ALTER TABLE chunks FORCE ROW LEVEL SECURITY` | [ ] | Migration SQL |
| Policy: `tenant_id = current_setting('app.current_tenant')` on both tables | [ ] | Migration SQL |
| Policy: `allowed_roles && current_setting('app.current_roles')::text[]` on chunks | [ ] | Migration SQL |
| Policy on `api_keys`: `tenant_id = current_setting('app.current_tenant')` | [ ] | Migration SQL |
| Revoke all on tables from `public` | [ ] | Migration SQL |

### 2.3 Authentication Middleware

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/auth/api-keys.ts`: lookup API key, verify hash, return `{ tenantId, roles }` | [ ] | New file |
| `src/lib/auth/middleware.ts`: Next.js middleware extracts `Authorization: Bearer <key>`, validates via `api-keys.ts`, sets headers `x-tenant-id`, `x-roles` | [ ] | New file |
| `src/lib/db/rls.ts`: `withRLS<T>(tenantId, roles, fn)` — runs `fn` inside a transaction with `SET LOCAL app.current_tenant = ...` and `SET LOCAL app.current_roles = ...`; throws if settings missing (fail closed) | [ ] | New file |
| Update `src/lib/db/client.ts` to export a `createAppPool()` using `rag_app` credentials (separate from migration pool) | [ ] | Edit |

### 2.4 Automated RLS Tests (Vitest + Testcontainers or Compose Postgres)

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `tests/rls/rls.test.ts`: insert rows for tenant A and B; query as tenant A → only A's rows; query as tenant B → only B's rows; query without settings → zero rows (fail closed); query with mismatched roles → zero rows | [ ] | New file |
| `tests/rls/api-key.test.ts`: valid key returns tenant/roles; invalid/revoked key throws; missing header throws | [ ] | New file |
| `tests/rls/withRLS.test.ts`: `withRLS` sets settings, runs fn, rolls back on error; settings not leaked across calls | [ ] | New file |
| GitHub Actions workflow `.github/workflows/rls-tests.yml`: spins up Compose Postgres, runs `pnpm test:rls` | [ ] | New file |
| Add `test:rls` script to package.json | [ ] | Edit |

### Acceptance Criteria

- Migration applies cleanly; `rag_app` role exists and has only required grants
- `FORCE ROW LEVEL SECURITY` is active on `documents` and `chunks`
- `withRLS(tenantId, roles, fn)` sets `SET LOCAL` inside a transaction; if `tenantId` or `roles` missing, throws before any query
- RLS tests pass in CI against a real Postgres (Compose)
- API key middleware returns 401 for missing/invalid/revoked keys; 200 with `x-tenant-id`, `x-roles` headers for valid keys

### Verification Commands

```bash
# 1. Apply migration
pnpm db:migrate

# 2. Verify schema & RLS
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  \d+ documents
  \d+ chunks
  \d+ api_keys
  \d+ tenants
  \d+ events
"

# 3. Verify rag_app role and grants
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('documents','chunks','api_keys','events') AND grantee = 'rag_app';
"

# 4. Verify FORCE RLS
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('documents','chunks');
"

# 5. Manual RLS test (as superuser)
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  INSERT INTO tenants (id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Tenant A'), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant B');
  INSERT INTO documents (id, tenant_id, title, content) VALUES (gen_random_uuid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Doc A', 'Content A'), (gen_random_uuid(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Doc B', 'Content B');
  SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT * FROM documents;  -- should return only Doc A
  RESET app.current_tenant;
  SELECT * FROM documents;  -- should return 0 rows (FORCE RLS)
"

# 6. Run automated RLS tests
pnpm test:rls
```

### ADR to Write: `docs/decisions.md` — ADR 002

**Title**: Row-Level Security with Non-Superuser App Role and SET LOCAL

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **RLS + `rag_app` role + `SET LOCAL` in transaction** | Fail-closed by default; settings scoped to transaction; no leakage across requests; standard Postgres feature | Requires careful middleware; `SET LOCAL` only works in transaction |
| RLS + `SET` (session-level) | Simpler | Settings leak across requests; must `RESET` manually; error-prone |
| Application-level filtering only | No DB changes | Easy to forget; no defense-in-depth; superuser bypasses |
| Separate schema per tenant | Perfect isolation | Operational complexity; migrations × N; not multi-tenant |

**Choice**: RLS with `rag_app` role, `FORCE ROW LEVEL SECURITY`, `SET LOCAL` inside transaction via `withRLS()` helper.

**Evidence**: pgvector 0.8.5 supports RLS on vector tables; `FORCE ROW LEVEL SECURITY` ensures superuser queries also respect policies; `SET LOCAL` is transaction-scoped and automatically reset on commit/rollback.

**Trade-offs Accepted**: Slightly more complex middleware; all queries must go through `withRLS()`.

---

### README Section to Update

- **Status**: Check off "Schema: documents, chunks (tenant_id, allowed_roles, embedding)" and add "API-key auth table, RLS with non-superuser app role, automated RLS tests in CI"
- **Architecture**: Add auth middleware box between Client and Next.js API
- **Tech stack**: Mention `rag_app` role, `FORCE ROW LEVEL SECURITY`, Vitest + CI

---

## Milestone 3: Corpus + Golden Set + Eval Runner

**Goal**: Download public English/Malayalam corpora, build synthetic tenants, create 60-item golden set (30 EN, 30 ML) referencing source documents and answer passages (not chunk IDs), and implement deterministic eval runner for recall@k and MRR with cached embeddings.

### 3.1 Corpus Download & Preparation

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `scripts/fetch-corpus.ts`: downloads public Wikipedia articles (EN + ML) via API; writes to `data/corpus/{en,ml}/` as JSONL: `{ id, title, content, url, language }` | [x] | New file |
| `scripts/seed-tenants.ts`: creates 3 synthetic tenants in DB, assigns corpus docs round-robin to tenants, generates API keys for each tenant | [x] | New file |
| `scripts/generate-golden.ts`: generates 60-item golden set (30 EN + 30 ML) with verbatim answer passages | [x] | New file |
| `pnpm eval:fetch` script runs corpus fetcher | [x] | `package.json` |
| `pnpm eval:seed` script seeds DB with tenants, documents, API keys | [x] | `package.json` |
| `pnpm eval:golden` script generates golden set | [x] | `package.json` |

### 3.2 Golden Set Format

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Define schema: `{ id, question, language, answer_passage, source_doc_id, source_doc_title, tenant_id, difficulty? }` — **references source document and answer passage, not chunk IDs** | [x] | `eval/golden/en.json`, `eval/golden/ml.json` |
| Create `eval/golden/en.json` (30 questions) from EN corpus | [x] | New file |
| Create `eval/golden/ml.json` (30 questions) from ML corpus | [x] | New file |
| Golden set items are derived from corpus: answer passage is a verbatim substring of the source document | [x] | Verified against corpus + database |

### 3.3 Malayalam-Safe Chunker

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/chunking/malayalam.ts`: uses `Intl.Segmenter('ml', { granularity: 'sentence' })` and paragraph boundaries (`\n\n`); falls back to grapheme clusters if segmenter unavailable; max 1000 chars, 200 overlap | [x] | New file |
| `src/lib/chunking/english.ts`: recursive splitter (sentence → paragraph → char) | [x] | New file |
| `src/lib/chunking/index.ts`: exports `chunkText(text, language)` dispatching by language | [x] | New file |
| `src/lib/chunking/normalize.ts`: NFC normalization + invisible/control char stripping, logs changes | [x] | New file |
| Unit tests: `tests/chunking/malayalam.test.ts` — verifies sentence boundaries preserved, no mid-word splits, overlap correct | [x] | New file (pure function, no Docker) |
| Unit tests: `tests/chunking/normalize.test.ts` — NFC, zero-width removal, control char removal, whitespace collapse | [x] | New file |

### 3.4 Eval Runner (Deterministic Metrics)

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `eval/embed-cache.ts`: caches embeddings to `eval/cache/embeddings-{model}.json` (key = hash(text)); loads on startup | [ ] | New file |
| `eval/retrieval-metrics.ts`: pure functions `recallAtK(results, goldDocIds, k)`, `mrr(results, goldDocIds)` — results are `{ docId, score }[]` | [ ] | New file (pure, no Docker) |
| `eval/run-retrieval.ts`: for each golden question, embeds question (cached), runs exact vector search (no HNSW) via SQL with tenant filter, computes recall@1/5/10 and MRR per language; outputs markdown table | [ ] | New file |
| `pnpm eval:retrieval` script | [ ] | `package.json` |
| Unit tests: `tests/eval/metrics.test.ts` — known inputs produce expected recall@k, MRR | [ ] | New file (pure) |

### 3.5 CI Gate

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| GitHub Actions `.github/workflows/eval-gate.yml`: runs `pnpm eval:fetch`, `pnpm eval:seed`, `pnpm eval:retrieval`; fails if recall@5 drops > 5% from committed baseline (stored in `eval/baseline.json`) | [ ] | New file |
| `eval/baseline.json`: `{ "en": { "recall@5": 0.XX }, "ml": { "recall@5": 0.XX } }` — updated only via PR with evidence | [ ] | New file |

### Acceptance Criteria

- `pnpm eval:fetch` downloads corpora to `data/corpus/` (gitignored)
- `pnpm eval:seed` creates 3 tenants, inserts documents, generates API keys
- Golden set has 60 items (30 EN, 30 ML), each with `source_doc_id` and `answer_passage` (verbatim substring of source)
- Malayalam chunker uses `Intl.Segmenter` and preserves sentence boundaries
- `pnpm eval:retrieval` runs in < 2 min, outputs markdown table with recall@1/5/10 and MRR per language
- CI gate fails if recall@5 drops > 5% from baseline
- All pure-function tests (chunking, metrics) pass without Docker

### Verification Commands

```bash
# 1. Fetch corpus (run once)
pnpm eval:fetch
ls -la data/corpus/en/ data/corpus/ml/

# 2. Seed tenants and documents
pnpm eval:seed
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT count(*) FROM documents;
"

# 3. Inspect golden set
cat eval/golden/en.json | jq '.[0]'
cat eval/golden/ml.json | jq '.[0]'

# 4. Test Malayalam chunker
pnpm test -- tests/chunking/malayalam.test.ts

# 5. Run retrieval eval
pnpm eval:retrieval

# 6. Run CI gate locally (simulate)
pnpm eval:retrieval 2>&1 | tail -30
```

### ADR to Write: `docs/decisions.md` — ADR 003

**Title**: Golden Set References Source Documents, Not Chunk IDs; Deterministic CI Gate

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Golden set references `source_doc_id` + `answer_passage`** | Chunking strategy can change without breaking evals; measures end-to-end retrieval quality; passage enables citation verification | Requires passage search in eval |
| Golden set references `chunk_ids` | Precise | Brittle — any chunking change invalidates golden set |
| LLM judge for retrieval quality | Captures semantic relevance | Non-deterministic; CI flakiness; cost |
| **Deterministic metrics (recall@k, MRR) with cached embeddings** | Fast, free, deterministic, CI-friendly | Doesn't measure semantic quality directly |
| CI gate on groundedness (LLM judge) | Measures answer quality | Non-deterministic; slow; expensive |

**Choice**: Golden set references source document + answer passage; CI gate uses deterministic recall@k/MRR with cached embeddings; groundedness measured separately (not a gate).

**Evidence**: Industry practice (BEIR, MTEB) uses corpus-level relevance; cached embeddings make evals fast and free; chunking is an implementation detail.

**Trade-offs Accepted**: Recall@k doesn't capture "good but not exact" retrieval; groundedness eval is separate and not a CI gate.

---

### ADR to Write: `docs/decisions.md` — ADR 004

**Title**: Malayalam Chunking with Intl.Segmenter; Simple FTS Config

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Intl.Segmenter('ml', { granularity: 'sentence' })** | Standard API; handles Malayalam sentence boundaries; no external deps | Requires Node 18+; ICU data must be present |
| Custom rule-based splitter | Works offline | Hard to maintain; language-specific |
| whitespace/char splitting | Simple | Breaks words; poor retrieval |

**Choice**: `Intl.Segmenter` for sentences + paragraph boundaries; max 1000 chars, 200 overlap.

**FTS Config**: Use `'simple'` config (no stemming, no stop words) with stored `tsvector` column + GIN index. Postgres full-text ranking is **not BM25** (it's a simplified tf-idf); document this limitation.

**Trade-offs Accepted**: Malayalam keyword search will be weak; vector search carries the load; hybrid RRF still helps.

---

### README Section to Update

- **Status**: Check off "Corpus + golden set + eval runner" with sub-items
- **Data**: Detail corpus sources, synthetic tenants, golden set format
- **Results**: Add baseline recall@5 numbers for EN/ML once measured
- **Tech stack**: Mention `Intl.Segmenter`, `simple` FTS config, eval cache

---

## Milestone 4: Ingestion Pipeline

**Goal**: `POST /api/ingest` (authenticated via API key) → idempotent document creation → BullMQ job → worker chunks, embeds, upserts with tenant/role context. Kill-the-worker test proves idempotency.

### 4.1 API Endpoint

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Zod schema: `title`, `content`, `source?`, `metadata?`, `language?` (default 'en') — **no tenantId/roles in body** | [ ] | `src/app/api/ingest/route.ts` |
| `POST /api/ingest` route: uses auth middleware (Milestone 2) to get `tenantId`, `roles`; computes content hash (sha256); checks `documents` for existing `content_hash` + `tenant_id` → returns existing `jobId`/`documentId` if found | [ ] | `src/app/api/ingest/route.ts` |
| Insert document with `status: 'pending'`, `content_hash`, `language`, `tenant_id` | [ ] | Same |
| Enqueue BullMQ job `index-document` with `{ documentId, tenantId, roles }` | [ ] | Same |
| Returns 202 `{ jobId, documentId, status: 'queued' }` | [ ] | Same |

### 4.2 BullMQ Queue & Worker Setup

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/queue/client.ts`: BullMQ queue singleton `ingestionQueue` with Redis connection, default job options (removeOnComplete: 1000, removeOnFail: 5000) | [ ] | New file |
| `src/lib/queue/types.ts`: Job payload types `IndexDocumentJob`, `EmbedChunksJob` | [ ] | New file |
| `worker/index.ts`: worker entry; registers `index-document` processor; graceful shutdown on SIGTERM | [ ] | New file |
| `worker/processors/index-document.ts`: processor that calls chunking → embedding → upsert | [ ] | New file |

### 4.3 Worker: Chunking, Embedding, Upsert

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/embedding/providers.ts`: interface `EmbeddingProvider` with `embed(texts: string[]): Promise<number[][]>`; implementations: `OpenAIEmbeddingProvider`, `LocalEmbeddingProvider` (Ollama), `CachedEmbeddingProvider` (wraps any provider + LRU cache) | [ ] | New file |
| `src/lib/embedding/index.ts`: factory `getEmbeddingProvider()` reads `EMBEDDING_PROVIDER` env; default OpenAI; free-tier-friendly option with rate-limit handling (exponential backoff, max retries) | [ ] | New file |
| Chunking: use `chunkText(content, language)` from Milestone 3 | [ ] | Import |
| Upsert chunks: `withRLS(tenantId, roles, async (tx) => { await tx.insert(chunks).values(...).onConflictDoUpdate({ target: chunks.id, set: { embedding, content, metadata } }) })` — idempotent on chunk ID (deterministic UUID from hash) | [ ] | `worker/processors/index-document.ts` |
| Update document `status: 'completed'` or `status: 'failed'` with `error_message` | [ ] | Same |
| Retry: BullMQ `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }` | [ ] | Queue options |
| Dead letter: `failed` queue inspected via BullMQ UI or script | [ ] | Documented |

### 4.4 Idempotency & Kill-the-Worker Test

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Chunk ID generation: deterministic UUID v5 from `sha256(documentId + chunkIndex)` — same chunks always get same IDs | [ ] | `worker/processors/index-document.ts` |
| `tests/ingestion/idempotency.test.ts`: start worker, submit doc, kill worker mid-processing (SIGKILL), restart worker, verify doc completes with correct chunks, no duplicates | [ ] | New file (requires Docker) |
| `tests/ingestion/duplicate-request.test.ts`: submit same content twice → returns same documentId, no duplicate chunks | [ ] | New file |

### Acceptance Criteria

- `POST /api/ingest` with valid API key returns 202 with `jobId`, `documentId`
- Duplicate request (same content + tenant) returns existing `documentId` and `jobId`
- Worker processes job: chunks → embeds → upserts with correct `tenant_id`, `allowed_roles`
- Chunks have deterministic IDs; re-processing same document produces identical chunk rows
- Kill-the-worker test passes: worker killed mid-job, restart completes job correctly, no duplicate chunks
- Failed jobs go to DLQ after 3 attempts

### Verification Commands

```bash
# 1. Start worker
pnpm worker &

# 2. Ingest a document (use API key from seed)
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key-tenant-a>" \
  -d '{"title":"Test Doc","content":"This is a test document about RAG systems.","language":"en"}'
# → { "jobId": "...", "documentId": "...", "status": "queued" }

# 3. Wait for worker, check chunks
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SELECT chunk_index, left(content, 60), embedding IS NOT NULL as has_embedding FROM chunks ORDER BY chunk_index;
"

# 4. Duplicate request test
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key-tenant-a>" \
  -d '{"title":"Test Doc","content":"This is a test document about RAG systems.","language":"en"}'
# → same documentId, jobId

# 5. Kill-the-worker test
pnpm test:ingestion:idempotency  # runs the kill test

# 6. Check events table
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SELECT type, tenant_id, created_at FROM events ORDER BY created_at DESC LIMIT 10;
"
```

### ADR to Write: `docs/decisions.md` — ADR 005

**Title**: Idempotent Ingestion with Content Hash + Deterministic Chunk IDs; Kill-the-Worker Test

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Content hash + deterministic chunk UUIDs + upsert on conflict** | Survives worker crashes; duplicate requests safe; no distributed locks needed | Chunk IDs must be deterministic; content hash must be stable |
| Job-level idempotency key only | Simpler | Doesn't protect against mid-job crashes |
| Distributed lock (Redis SETNX) | Stronger guarantees | Complexity; single point of contention |
| **Kill-the-worker test in CI** | Proves idempotency empirically | Requires Docker in CI; slower |

**Choice**: Content hash on document (sha256), deterministic chunk UUIDs (UUID v5 from documentId + chunkIndex), upsert on conflict. Kill-the-worker test runs in CI.

**Evidence**: BullMQ retries with exponential backoff; deterministic IDs make upsert safe; content hash prevents duplicate documents per tenant.

**Trade-offs Accepted**: UUID v5 requires stable documentId (known at enqueue time); content hash means identical content in different tenants = different documents (correct for multi-tenant).

---

### README Section to Update

- **Status**: Check off "Ingestion pipeline (BullMQ): parse, chunk, embed, index, with retries and idempotency"
- **Architecture**: Worker box detail: chunk → embed → upsert (idempotent)
- **Tech stack**: Mention `CachedEmbeddingProvider`, rate-limit handling, kill-the-worker test

---

## Milestone 5: Retrieval Baselines + CI Gate

**Goal**: Implement exact vector search + keyword search (simple FTS) + hybrid RRF, all behind RLS. CI gate runs deterministic retrieval metrics on golden set with cached embeddings.

### 5.1 Search Library

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/retrieval/search.ts`: `exactVectorSearch(queryEmbedding, tenantId, roles, topK)` — SQL: `SELECT id, document_id, content, metadata, 1 - (embedding <=> $1) AS score FROM chunks WHERE tenant_id = $2 AND allowed_roles && $3 ORDER BY embedding <=> $1 LIMIT $4` | [ ] | New file |
| `keywordSearch(query, tenantId, roles, topK, language)` — uses `to_tsvector('simple', content) @@ plainto_tsquery($1)` for both languages; ranks by `ts_rank_cd` | [ ] | New file |
| `hybridSearch(queryEmbedding, queryText, tenantId, roles, topK, language)` — runs both, combines via Reciprocal Rank Fusion (RRF) with `k=60` | [ ] | New file |
| All functions use `withRLS(tenantId, roles, ...)` | [ ] | Same |
| Export types: `SearchResult { id, documentId, content, metadata, score, source: 'vector' | 'keyword' | 'hybrid' }` | [ ] | Same |

### 5.2 Malayalam FTS

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Add `tsv` column to `chunks`: `tsvector` generated from `content` using `'simple'` config | [ ] | Migration (Milestone 2) |
| GIN index on `chunks(tsv)` | [ ] | Migration |
| `keywordSearch` uses `to_tsvector('simple', content)` for both EN and ML | [ ] | `src/lib/retrieval/search.ts` |
| Document in README: Postgres FTS ranking is not BM25 | [ ] | README |

### 5.3 Retrieval Eval Integration

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `eval/run-retrieval.ts` uses `hybridSearch` (and `exactVectorSearch`, `keywordSearch` separately) via a test harness that calls the same code path as API | [ ] | Edit |
| Outputs markdown table: method × language × recall@1/5/10 + MRR | [ ] | Same |
| CI gate (`.github/workflows/eval-gate.yml`) compares recall@5 against `eval/baseline.json` | [ ] | Already in Milestone 3 |

### 5.4 Vector Search: Exact First, HNSW Later

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Verify pgvector 0.8.5 supports `ivfflat` and `hnsw`; iterative scan (`SET enable_seqscan = off`) works with exact search | [ ] | Manual test |
| Document: HNSW is a logged experiment; baseline uses exact search | [ ] | README, ADR |

### Acceptance Criteria

- `exactVectorSearch` returns top-K chunks with cosine similarity scores
- `keywordSearch` works for both EN and ML using `'simple'` config
- `hybridSearch` combines via RRF; results ranked correctly
- All searches respect RLS (tenant + roles)
- `pnpm eval:retrieval` outputs table with 4 methods × 2 languages
- CI gate passes with current baseline

### Verification Commands

```bash
# 1. Manual SQL test of exact vector search
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SET LOCAL app.current_roles = '{public}';
  SELECT id, left(content, 50), 1 - (embedding <=> '[0.1,0.2,...]'::vector) AS score
  FROM chunks
  ORDER BY embedding <=> '[0.1,0.2,...]'::vector
  LIMIT 5;
"

# 2. Keyword search test
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SET LOCAL app.current_tenant = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  SET LOCAL app.current_roles = '{public}';
  SELECT id, left(content, 50), ts_rank_cd(tsv, plainto_tsquery('simple', 'RAG')) AS rank
  FROM chunks
  WHERE tsv @@ plainto_tsquery('simple', 'RAG')
  ORDER BY rank DESC
  LIMIT 5;
"

# 3. Run retrieval eval
pnpm eval:retrieval

# 4. Check CI gate locally
cat eval/baseline.json
```

### ADR to Write: `docs/decisions.md` — ADR 006

**Title**: Exact Vector Search Baseline; HNSW as Logged Experiment

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Exact search (sequential scan) baseline** | Correctness guaranteed; no index tuning; works with RLS filters | O(N) — slow at scale |
| HNSW from start | Fast at scale | Approximate; recall varies with `ef_search`; iterative scan support in pgvector 0.8.5 needs verification; index build time |
| IVFFlat | Faster than exact | Requires training; less stable recall |

**Choice**: Baseline uses exact search (`ORDER BY embedding <=> $query`). HNSW experiment logged separately with `ef_search` tuning and recall@k comparison.

**Evidence**: pgvector 0.8.5 supports HNSW; exact search is correct by definition; 100k vectors still sub-second on modern hardware.

**Trade-offs Accepted**: Baseline slower; HNSW experiment required before production scale.

---

### ADR to Write: `docs/decisions.md` — ADR 007

**Title**: Hybrid Search with RRF; Simple FTS Config for Malayalam

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **RRF (Reciprocal Rank Fusion)** | Parameter-free; robust; combines any rankers | Assumes ranks are meaningful |
| Weighted score fusion | Tunable | Requires weight tuning per language |
| Concatenation + rerank | Simpler downstream | Loses ranker diversity |

**Choice**: RRF with `k=60`. Keyword search uses `'simple'` FTS config for both languages (no stemming, no stop words). Postgres `ts_rank_cd` is not BM25.

**Evidence**: RRF widely used (Vespa, Elasticsearch); `simple` config works for any language; Malayalam has no dictionary in Postgres.

**Trade-offs Accepted**: Malayalam keyword search weak; vector carries load; hybrid still helps.

---

### README Section to Update

- **Status**: Check off "Hybrid retrieval (vector + keyword) with tenant/role filtering"
- **Results**: Fill in baseline recall@5 / MRR for 4 methods × 2 languages
- **Architecture**: Detail search library functions
- **Tech stack**: Mention RRF, `simple` FTS, exact search baseline

---

## Milestone 6: Experiments (Chunking, Embeddings, Reranking)

**Goal**: Run logged experiments varying chunking strategy, embedding models, and rerankers. Each experiment updates the results table in README. No code changes to production path — only eval scripts and config.

### 6.1 Chunking Experiments

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `eval/experiments/chunking.ts`: varies `chunk_size` (500, 1000, 1500), `overlap` (100, 200, 300), sentence vs paragraph vs recursive; re-chunks corpus, re-embeds, runs retrieval eval | [ ] | New file |
| Results appended to `eval/results/chunking-{timestamp}.json` | [ ] | Same |
| README results table updated with best config per language | [ ] | README |

### 6.2 Embedding Model Experiments

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `eval/experiments/embeddings.ts`: tests `text-embedding-3-small` (1536), `text-embedding-3-large` (3072), `text-embedding-ada-002` (1536), local models (BGE, E5 via Ollama) | [ ] | New file |
| Each model: re-embeds corpus (cached), runs retrieval eval | [ ] | Same |
| Documents dimension change → requires re-migration (noted) | [ ] | README |

### 6.3 Reranking Experiments

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `eval/experiments/rerank.ts`: tests Cohere Rerank v3.5, BGE-reranker-large (local), cross-encoder-ms-marco | [ ] | New file |
| Input: top-20 from hybrid search → output: top-5 reranked | [ ] | Same |
| Metrics: recall@5 after rerank, latency, cost | [ ] | Same |

### 6.4 Experiment Runner & Logging

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `pnpm eval:experiment <name>` script | [ ] | `package.json` |
| Each experiment logs: config, timestamp, git commit, metrics, cost, latency | [ ] | `eval/results/` |
| README results table has "Best config" row per language | [ ] | README |

### Acceptance Criteria

- Each experiment runs independently, re-uses cached embeddings where possible
- Results are reproducible (same commit + config = same metrics)
- README results table reflects best config for each language
- Experiments don't modify production code paths

### Verification Commands

```bash
# Run chunking experiment
pnpm eval:experiment chunking

# Run embedding experiment
pnpm eval:experiment embeddings

# Run rerank experiment
pnpm eval:experiment rerank

# View results
cat eval/results/chunking-*.json | jq .
cat eval/results/embeddings-*.json | jq .
cat eval/results/rerank-*.json | jq .
```

### ADR to Write: `docs/decisions.md` — ADR 008

**Title**: Experiments as Eval Scripts, Not Production Code Changes

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Experiments in `eval/experiments/` only** | Production path stable; experiments reproducible; no feature flags | Manual to promote best config |
| Feature flags in production | Easy rollout | Complexity; config drift |
| A/B testing in prod | Real traffic | Requires traffic; not for portfolio |

**Choice**: Experiments are standalone eval scripts that re-chunk/re-embed/re-rank and measure. Best config promoted via PR updating config constants.

**Evidence**: Keeps production code clean; portfolio demonstrates scientific approach.

**Trade-offs Accepted**: Manual promotion step; not automated.

---

### README Section to Update

- **Results**: Add experiment sub-tables (chunking, embeddings, reranking) with best config per language
- **What broke and how I fixed it**: Log surprising results (e.g., "Malayalam recall dropped with larger chunks")

---

## Milestone 7: /ask with Citations + Groundedness

**Goal**: `POST /api/ask` (authenticated) → hybrid search → rerank (optional) → prompt with numbered citations → stream answer via Vercel AI SDK → citation verification + "I don't know" threshold tuned on golden set → provider fallback.

### 7.1 Reranker Integration

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/rerank/providers.ts`: interface `Reranker` with `rerank(query, chunks, topK)`; implementations: `CohereReranker`, `LocalReranker` (BGE via Ollama), `NoOpReranker` | [ ] | New file |
| `src/lib/rerank/index.ts`: factory `getReranker()` reads `RERANKER_PROVIDER` env | [ ] | New file |
| Rerank called in retrieval pipeline: `hybridSearch` → `reranker.rerank()` → top-K | [ ] | `src/lib/retrieval/search.ts` |

### 7.2 Prompt Builder with Citations

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/prompts/ask.ts`: `buildAskPrompt(question, chunks)` — chunks numbered `[1]`, `[2]`...; includes instruction: "Answer using only the provided context. Cite sources like [1]. If answer not in context, say 'I don't know.'" | [ ] | New file |
| Citation format: `[1]` inline; footer with full citation list: `[1] Doc Title (chunk 3)` | [ ] | Same |

### 7.3 /api/ask Route Handler

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Zod schema: `question`, `topK?`, `rerank?`, `language?` — **no tenantId/roles** | [ ] | `src/app/api/ask/route.ts` |
| Auth middleware provides `tenantId`, `roles` | [ ] | Same |
| Pipeline: embed question → `hybridSearch` → optional rerank → `buildAskPrompt` → `streamText` (Vercel AI SDK) | [ ] | Same |
| Streaming response: `text` delta + `citations` event at end | [ ] | Same |
| Provider fallback: if primary chat model fails, retry with fallback (configurable) | [ ] | Same |

### 7.4 "I Don't Know" Threshold

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Threshold: max hybrid score < `DONT_KNOW_THRESHOLD` (tuned on golden set) → return "I don't know" without LLM call | [ ] | `src/app/api/ask/route.ts` |
| `eval/tune-threshold.ts`: sweeps threshold on golden set, maximizes F1 (correct "I don't know" vs incorrect answers) | [ ] | New file |
| Threshold stored in `eval/threshold.json` | [ ] | Same |

### 7.5 Citation Verification

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/verification/citations.ts`: `verifyCitations(answer, chunks)` — extracts `[n]` citations, checks each cited chunk was in retrieved set, checks answer doesn't hallucinate content not in cited chunks | [ ] | New file |
| `eval/groundedness.ts`: runs citation verification on golden set answers; reports % verified | [ ] | New file |

### 7.6 Groundedness Eval (LLM Judge, Not a Gate)

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `eval/groundedness-judge.ts`: uses LLM to score answer faithfulness to citations (1-5) | [ ] | New file |
| Reports agreement with human judgment (sampled) | [ ] | Same |
| Not a CI gate | [ ] | Documented |

### Acceptance Criteria

- `POST /api/ask` with valid API key streams tokens incrementally
- Citations included in stream (`data: {"type":"citations",...}`)
- "I don't know" triggered when max score < threshold
- Provider fallback works (tested by simulating primary failure)
- Citation verification passes for golden set answers
- Groundedness score reported (not gated)

### Verification Commands

```bash
# 1. Tune threshold
pnpm eval:tune-threshold
cat eval/threshold.json

# 2. Ask a question
curl -N -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key-tenant-a>" \
  -d '{"question":"What is RAG?","topK":5,"rerank":true}'

# 3. Test "I don't know"
curl -N -X POST http://localhost:3000/api/ask \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key-tenant-a>" \
  -d '{"question":"What is the capital of Mars?","topK":5}'

# 4. Citation verification on golden set
pnpm eval:groundedness

# 5. Provider fallback test (simulate by setting invalid primary key)
```

### ADR to Write: `docs/decisions.md` — ADR 009

**Title**: Citation-Verified Answers with "I Don't Know" Threshold; Provider Fallback

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Threshold on max retrieval score** | Fast; no LLM call for "I don't know"; tunable on golden set | Score distribution shifts with corpus |
| LLM self-verification | Semantic | Slow; non-deterministic; circular |
| Always call LLM | Simpler | Hallucinates on out-of-domain |

**Choice**: Threshold on max hybrid score (cosine similarity). Tuned on golden set to maximize F1. If triggered, returns "I don't know" without LLM call.

**Provider Fallback**: Configurable ordered list of chat providers; on error, retries next provider. Logs fallback event.

**Citation Verification**: Post-hoc check that every `[n]` in answer maps to a retrieved chunk; answer text subset of cited chunks (allowing paraphrase).

**Trade-offs Accepted**: Threshold needs re-tuning if corpus changes significantly; provider fallback adds latency on failure.

---

### README Section to Update

- **Status**: Check off "Reranking and cited answers with an 'I don't know' path"
- **Architecture**: Detail `/ask` pipeline: embed → hybrid → rerank → prompt → stream
- **Results**: Add groundedness score, "I don't know" precision/recall
- **Tech stack**: Mention citation verification, threshold tuning, provider fallback

---

## Milestone 8: Observability, Leakage Tests, Load Test, Provider Fallback

**Goal**: Events table + structured logs for tokens/cost/latency; automated cross-tenant leakage test suite; load test with p50/p95; provider fallback hardening.

### 8.1 Events Table + Structured Logging

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/observability/events.ts`: `recordEvent(type, tenantId, payload)` — inserts into `events` table | [ ] | New file |
| Event types: `ingest.started`, `ingest.completed`, `ingest.failed`, `ask.started`, `ask.completed`, `ask.failed`, `provider.fallback`, `rls.violation` | [ ] | Same |
| `src/lib/observability/logger.ts`: Pino logger with `tenantId`, `requestId`, `latencyMs`, `tokensIn`, `tokensOut`, `costUsd` | [ ] | New file |
| Middleware adds `requestId` (UUID) to all requests; passed to `withRLS` and events | [ ] | `src/lib/auth/middleware.ts` |
| Cost calculation: embedding tokens × $/1k + completion tokens × $/1k (configurable per model) | [ ] | `src/lib/observability/cost.ts` |

### 8.2 Leakage Test Suite

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `tests/leakage/leakage.test.ts`: seeds canary document per tenant (unique phrase); queries as tenant A → asserts zero results for tenant B's canary; tests via API and direct SQL | [ ] | New file |
| `pnpm test:leakage` script | [ ] | `package.json` |
| Runs in CI (`.github/workflows/leakage.yml`) | [ ] | New file |
| Target: zero leaks on suite | [ ] | Verified |

### 8.3 Load Test

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `tests/load/load.test.ts`: uses `wrk` or `k6` script; 10 RPS for 60s against `/api/ask`; reports p50, p95, p99 latency, error rate | [ ] | New file |
| `pnpm test:load` script | [ ] | `package.json` |
| Runs manually (not in CI) | [ ] | Documented |

### 8.4 Provider Fallback Hardening

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `src/lib/ai/providers.ts`: ordered list `[primary, fallback1, fallback2]`; each with `chat()` and `embed()`; circuit breaker per provider (3 failures → skip for 30s) | [ ] | New file |
| Fallback events recorded in `events` table | [ ] | Same |
| Rate-limit handling: 429 → exponential backoff + retry with fallback | [ ] | Same |

### Acceptance Criteria

- Every request logs structured JSON with `requestId`, `tenantId`, `latencyMs`, `tokensIn`, `tokensOut`, `costUsd`
- `events` table queryable for debugging and dashboards
- Leakage test suite passes (zero cross-tenant hits)
- Load test reports p50/p95 latency under target (e.g., p95 < 2s at 10 RPS)
- Provider fallback triggers on simulated failures; circuit breaker prevents cascade

### Verification Commands

```bash
# 1. Run leakage tests
pnpm test:leakage

# 2. Query events
docker exec rag-service-postgres-1 psql -U postgres -d rag_service -c "
  SELECT type, tenant_id, payload, created_at FROM events ORDER BY created_at DESC LIMIT 20;
"

# 3. Run load test (manual)
pnpm test:load

# 4. Test provider fallback
# Set invalid primary key, valid fallback key
curl -N -X POST http://localhost:3000/api/ask \
  -H "Authorization: Bearer <key>" \
  -d '{"question":"test"}'
# Check events for provider.fallback
```

### ADR to Write: `docs/decisions.md` — ADR 010

**Title**: Events Table + Structured Logs for Observability; No Prometheus

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Events table + Pino structured logs** | Queryable in SQL; no extra infra; works in serverless; correlates with tenant/request | No built-in dashboards |
| Prometheus + Grafana | Industry standard; rich queries | Extra infra; not serverless-friendly; overkill for portfolio |
| OpenTelemetry | Vendor-neutral | Complex setup; extra deps |

**Choice**: Events table (immutable log) + Pino JSON logs. Cost/latency/tokens per request. Queryable via SQL for ad-hoc analysis.

**Leakage Tests**: Automated canary-based tests in CI. Zero leaks on suite = pass.

**Load Test**: `k6` or `wrk` script, run manually. Reports p50/p95/p99.

**Trade-offs Accepted**: No real-time dashboards; manual load tests.

---

### README Section to Update

- **Status**: Check off "Tracing, cost per query, p50/p95 latency", "Leakage test suite (cross-tenant canaries)"
- **Results**: Add leakage test result (pass/fail), load test p50/p95
- **Tech stack**: Mention events table, Pino, k6/wrk, circuit breaker

---

## Milestone 9: README Results, Demo, Optional Deploy

**Goal**: Fill in all README results tables, create 2-minute demo script, optionally deploy to Vercel (API) + Railway/Render (worker).

### 9.1 README Results Complete

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Fill retrieval results table (4 methods × 2 languages × recall@5, MRR) | [ ] | `README.md` |
| Fill experiment results (best chunking, embedding, reranker per language) | [ ] | `README.md` |
| Fill groundedness score, "I don't know" precision/recall | [ ] | `README.md` |
| Fill leakage test result, load test p50/p95, cost per 1k queries | [ ] | `README.md` |
| Add "What broke and how I fixed it" entries | [ ] | `README.md` |

### 9.2 Demo Script

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| `scripts/demo.ts`: ingests 3 docs (EN, ML, mixed) → asks 3 questions → prints answers with citations | [ ] | New file |
| `pnpm demo` script runs it | [ ] | `package.json` |
| Demo runs in < 2 minutes | [ ] | Verified |

### 9.3 Optional Deploy

| Task | Status | Files to Create/Edit |
|------|--------|----------------------|
| Vercel deploy: Next.js API (static + functions); env vars configured | [ ] | Vercel dashboard |
| Worker deploy: Railway/Render background worker; same Docker image | [ ] | Railway/Render dashboard |
| Shared Postgres: Neon or managed PG with pgvector | [ ] | External |
| Shared Redis: Upstash or managed Redis | [ ] | External |
| Live demo URL added to README | [ ] | `README.md` |

### Acceptance Criteria

- All README tables filled with real numbers
- `pnpm demo` runs end-to-end in < 2 min
- Optional: live demo URL works

### Verification Commands

```bash
# 1. Run demo
pnpm demo

# 2. Verify README tables populated
grep -A 20 "Results" README.md

# 3. If deployed, test live URL
curl https://rag-service.vercel.app/api/health
```

### ADR to Write: `docs/decisions.md` — ADR 011

**Title**: Demo Script + Optional Deploy; Results in README

**Options Considered**:
| Option | Pros | Cons |
|--------|------|------|
| **Demo script + live deploy** | Tangible proof; interview-ready | Deploy maintenance |
| Demo script only | No maintenance | No live proof |
| Video only | Easy | Not interactive |

**Choice**: Demo script required; live deploy optional but recommended for portfolio.

**Trade-offs Accepted**: Deploy costs money; documented in README.

---

### README Section to Update

- **Status**: All items checked
- **Results**: Complete tables
- **Quick start**: Add live demo URL if deployed
- **What broke and how I fixed it**: Populated

---

## Current Sprint Focus

**Next 3 checkpoints** (do in order):

1. **[x] Milestone 2 complete** — Multi-tenant schema, `rag_app` role, `FORCE ROW LEVEL SECURITY`, `withRLS()` helper, API-key auth, automated RLS tests in CI
2. **[~] Milestone 3 in progress** — Corpus download, synthetic tenants, golden set (60 items, doc+passage refs), Malayalam chunker (`Intl.Segmenter`), eval runner (recall@k, MRR, cached embeddings), CI gate
   - [x] Corpus fetcher + tenant seeder + golden set generator scripts
   - [x] Malayalam + English chunker with grapheme-safe overlap
   - [x] Unicode normalization (NFC + invisible char stripping)
   - [ ] Eval runner: recall@k, MRR, cached embeddings
   - [ ] CI gate: recall@5 regression threshold
3. **[ ] Milestone 4 complete** — `POST /api/ingest` (authenticated), idempotent document creation, BullMQ worker with deterministic chunk IDs, kill-the-worker test passes

---

## How to Use This Plan

```bash
# Start a task
# 1. Update status to [~] in this file
# 2. Implement
# 3. Run verification commands
# 4. Update status to [x]
# 5. Commit with message referencing milestone
git commit -m "feat(milestone-2): add tenant_id, allowed_roles, api_keys, RLS policies"

# Do not start Milestone N+1 until Milestone N verification passes.
```

---

## Assumptions & Unverified Items

1. **pgvector 0.8.5 iterative scan support**: Assumed exact search works with `ORDER BY embedding <=> $query` without HNSW. Need to verify `SET enable_seqscan = off` doesn't break it. (Unverified — will test in Milestone 5)

2. **Intl.Segmenter for Malayalam**: Requires Node with full ICU data. Assumed available in Node 22+ (default). If not, fallback to grapheme clusters. (Unverified — will test in Milestone 3)

3. **Postgres `simple` FTS config ranking**: Confirmed not BM25 (it's a simplified tf-idf). Need to document exact ranking formula. (Partially verified — Postgres docs)

4. **pgvector HNSW with RLS filters**: HNSW index on `embedding` alone can't filter by `tenant_id` efficiently. Filtered HNSW requires `tenant_id` in index or iterative scan. Assumed exact search baseline; HNSW experiment will test `WHERE tenant_id = $1 ORDER BY embedding <=> $2 LIMIT $3` with HNSW index. (Unverified — pgvector 0.8.5 may not use HNSW with WHERE clause)

5. **BullMQ worker graceful shutdown**: `SIGTERM` handling assumed to work with `worker.close()`. Need to verify jobs are marked failed and retried. (Unverified — will test in Milestone 4)

6. **Vercel AI SDK streaming with custom citation events**: Assumed `streamText` supports custom data events via `onFinish` or custom chunk format. (Unverified — will test in Milestone 7)

7. **Provider fallback circuit breaker**: Simple in-memory circuit breaker assumed sufficient for single-worker. For multi-worker, would need Redis-backed. (Assumption documented)

8. **Cost calculation accuracy**: Based on published $/1k token prices; actual may vary with batching, caching. (Approximation accepted)

9. **CI environment for RLS tests**: GitHub Actions supports Docker Compose; assumed `docker compose up -d` works in CI. (Standard, unverified in this repo)

10. **Malayalam Wikipedia API access**: Assumed public API allows bulk download. If rate-limited, will use smaller sample. (Unverified)
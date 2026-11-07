# RAG Service

A multi-tenant "ask your documents" service with permission-aware retrieval, built to be measured, not just demoed. It also includes a retrieval benchmark for **English and Malayalam**.

**Status: work in progress.** Only the items checked below exist today. Result numbers are filled in as each milestone ships.

## Why this project exists

Most RAG demos answer questions. Few show that retrieval is **correct**, **safe between tenants**, and **measured**. This project focuses on three things:

1. **Permission-aware retrieval.** Tenant and role filters run inside the SQL query, before ranking, with Postgres row-level security as a backstop.
2. **Evals as a CI gate.** A golden question set scores retrieval (recall@k, MRR) and answer groundedness. A regression fails the build.
3. **A Malayalam + English benchmark.** Chunking, embedding models, hybrid search, and reranking are compared per language, including the results that disappoint.

## Status

- [x] Next.js app, Postgres 16 + pgvector, Redis, Docker Compose
- [x] Health endpoint (`/api/health`) checking Postgres and Redis
- [ ] Schema: documents, chunks (tenant_id, allowed_roles, embedding)
- [ ] Ingestion pipeline (BullMQ): parse, chunk, embed, index, with retries and idempotency
- [ ] Hybrid retrieval (vector + keyword) with tenant/role filtering
- [ ] Reranking and cited answers with an "I don't know" path
- [ ] Golden set (English + Malayalam) and eval script
- [ ] CI eval gate
- [ ] Tracing, cost per query, p50/p95 latency
- [ ] Leakage test suite (cross-tenant canaries)
- [ ] Two-minute demo and live deployment

## Architecture

```
Upload -> Next.js API -> Redis queue (BullMQ) -> Worker: chunk -> embed -> index -> Postgres + pgvector
                                                                                         ^
Question -> Next.js API -> filter by tenant/role -> hybrid search -> rerank -> LLM -------+
                                                                       (answer with citations)
```

- The **API** accepts requests and returns quickly.
- The **worker** is a separate process, because embedding is slow and can fail. Jobs retry with backoff and are idempotent (keyed by content hash).
- **Postgres** holds documents, chunks, vectors, and keyword indexes in one place.

## Results

Filled in as milestones complete. Nothing below is measured yet.

| Retrieval method | English recall@5 | Malayalam recall@5 | MRR |
|------------------|------------------|--------------------|-----|
| Keyword only     | -                | -                  | -   |
| Vector only      | -                | -                  | -   |
| Hybrid           | -                | -                  | -   |
| Hybrid + rerank  | -                | -                  | -   |

Also to be reported: groundedness score, cross-tenant leakage tests (target: zero on the suite), cost per 1,000 queries, and p50/p95 latency.

## Tech stack

Next.js (App Router), TypeScript, PostgreSQL 16 + pgvector, Drizzle ORM, BullMQ + Redis, Vercel AI SDK, Zod. Node 22+, pnpm.

The model provider is swappable. Embedding dimensions are fixed per model, so changing the embedding model requires re-embedding all chunks.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # set DATABASE_URL, REDIS_URL, and a model API key
docker compose up -d              # Postgres + Redis (local development only)
pnpm db:migrate
pnpm dev                          # Next.js on :3000
pnpm worker                       # BullMQ worker, in a second terminal

curl http://localhost:3000/api/health
# {"db":"ok","redis":"ok"}
```

Default credentials in `docker-compose.yml` are for local development only.

## Data

This repo uses **public data only**: public documentation and Wikipedia articles in both languages, with synthetic tenants and roles layered on top. Raw corpora are not committed. A download script will fetch them.

## Design and decisions

- [System design](docs/design.md)
- [Decision log](docs/decisions.md): each choice records the options, the choice, and the evidence.

## What broke and how I fixed it

Added as I hit real problems.

## Limits

- Zero leaks means zero on the included test suite, not a proof of isolation.
- Malayalam keyword search is weak with Postgres full-text search, because no Malayalam dictionary ships by default. This is being measured.
- Evals use an LLM judge, and its agreement with hand-checked judgments is reported separately.

## License

MIT
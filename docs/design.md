# RAG Service Design Document

## Overview
A production-grade Retrieval-Augmented Generation (RAG) service built with Next.js, PostgreSQL + pgvector, Redis + BullMQ, and the Vercel AI SDK.

## System Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  Next.js    │────▶│ PostgreSQL  │
│  (Browser)  │     │  API Routes │     │  + pgvector │
└─────────────┘     └──────┬──────┘     └──────┬──────┘
                           │                   │
                    ┌──────▼──────┐     ┌──────▼──────┐
                    │    Redis    │◀───▶│  BullMQ     │
                    │  (Queue)    │     │  Worker     │
                    └─────────────┘     └─────────────┘
```

## Components

### 1. API Layer (Next.js App Router)
- `GET /api/health` - Health check (DB + Redis)
- `POST /api/ingest` - Accept document, return jobId, queue processing
- `POST /api/ask` - Accept question, return streaming answer

### 2. Worker Process (BullMQ)
- Separate process: `pnpm worker` (tsx watch worker/index.ts)
- Jobs: `embed-chunks`, `index-document`
- Retries: Exponential backoff, max 3 attempts
- Idempotency: Job idempotency keys prevent duplicate processing

### 3. Database Schema
- `documents` - Source documents with metadata
- `chunks` - Text chunks with 1536-dim embeddings (HNSW index)

### 4. Retrieval Pipeline
1. Embed query (same model as chunks)
2. Vector similarity search (cosine, top-k=20)
3. Optional: Rerank with cross-encoder
4. Build context with citations
5. Stream LLM response

## Data Flow

### Ingestion
```
POST /api/ingest { title, content, source }
    │
    ▼
Create document row (status: "pending")
    │
    ▼
Return { jobId, documentId }
    │
    ▼
Queue "index-document" job (BullMQ)
    │
    ▼
Worker: chunk text → embed each → upsert chunks
    │
    ▼
Update document status: "completed"
```

### Query
```
POST /api/ask { question, topK?, filters? }
    │
    ▼
Embed question
    │
    ▼
Vector search (pgvector HNSW)
    │
    ▼
[Optional] Rerank
    │
    ▼
Build prompt with context + citations
    │
    ▼
Stream LLM response (Vercel AI SDK)
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | Required |
| `REDIS_URL` | Redis connection string | Required |
| `OPENAI_API_KEY` | For embeddings + chat | Required for prod |
| `EMBEDDING_MODEL` | Embedding model name | `text-embedding-3-small` |
| `CHAT_MODEL` | Chat model name | `gpt-4o-mini` |
| `CHUNK_SIZE` | Characters per chunk | 1000 |
| `CHUNK_OVERLAP` | Overlap between chunks | 200 |
| `TOP_K` | Vector search results | 20 |

## Scaling Considerations

| Component | Horizontal Scaling | Notes |
|-----------|-------------------|-------|
| Next.js API | Yes (stateless) | Use Vercel or Docker + LB |
| BullMQ Workers | Yes (add more) | Each worker processes jobs independently |
| PostgreSQL | Read replicas | pgvector HNSW index on primary |
| Redis | Cluster mode | BullMQ supports Redis Cluster |

## Security
- Rate limiting via Redis (per IP, per user)
- Input validation with Zod on all endpoints
- No raw SQL - Drizzle ORM prevents injection
- Secrets in environment variables only
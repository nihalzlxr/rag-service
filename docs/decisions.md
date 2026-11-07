# Architecture Decision Log

## ADR 001: Next.js Route Handlers vs Separate API Framework

**Date:** 2026-11-08
**Status:** Accepted

### Context
We need an API layer for the RAG service with endpoints for health checks, document ingestion, and question answering.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Next.js Route Handlers (App Router)** | Single language (TypeScript), unified deployment, built-in demo UI later, middleware support, streaming responses | Heavier than minimal API frameworks, Next.js-specific patterns |
| **Fastify/Hono/Express** | Lighter weight, more control, standard Node.js patterns | Separate deployment, separate repo or monorepo complexity, no built-in UI |
| **tRPC** | End-to-end type safety, great DX | Adds abstraction layer, overkill for simple REST endpoints |

### Decision
**Use Next.js Route Handlers (App Router)**

### Rationale
- **Single codebase**: Web UI + API in one repo, one language
- **Built-in streaming**: `ReadableStream` support for LLM responses
- **Middleware**: Auth, rate limiting, logging at edge
- **Future UI**: Can add admin dashboard / demo chat UI later without new infra
- **Team consistency**: Frontend team already knows Next.js

### Trade-offs Accepted
- Larger bundle than pure API framework (~50KB extra)
- Next.js-specific deployment (Vercel, Docker with standalone output)
- Can't easily swap to non-React frontend later (not a requirement)

### Consequences
- Worker process runs separately (tsx watch) - avoids Next.js compilation
- Shared code lives in `src/lib` imported via `@/*` alias
- API routes under `src/app/api/**/route.ts`
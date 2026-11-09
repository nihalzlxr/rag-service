import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  vector,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    source: text("source"), // URL, file path, etc.
    content: text("content").notNull(), // full text for reference
    tenantId: uuid("tenant_id").notNull(), // which tenant owns this document
    metadata: jsonb("metadata").default({}), // flexible extra data
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    titleIdx: index("documents_title_idx").on(table.title),
    createdAtIdx: index("documents_created_at_idx").on(table.createdAt),
    tenantIdIdx: index("documents_tenant_id_idx").on(table.tenantId),
  })
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    allowedRoles: text("allowed_roles")
      .array()
      .default(["public"])
      .notNull(), // which roles can read this chunk
    content: text("content").notNull(), // the chunk text
    embedding: vector("embedding", { dimensions: 1536 }), // pgvector column (OpenAI text-embedding-3-small = 1536)
    chunkIndex: integer("chunk_index").notNull(), // order within document
    metadata: jsonb("metadata").default({}), // page number, section, etc.
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    documentIdIdx: index("chunks_document_id_idx").on(table.documentId),
    tenantIdIdx: index("chunks_tenant_id_idx").on(table.tenantId),
    // HNSW index for fast vector similarity search (created in migration)
    embeddingIdx: index("chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  })
);

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("tenants_name_idx").on(table.name),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    keyHash: text("key_hash").notNull(), // sha256 hash of the actual key (never plaintext)
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    roles: text("roles").array().default(["public"]).notNull(), // roles assigned to this key
    name: text("name").notNull(), // human-readable label
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"), // null = active
  },
  (table) => ({
    tenantIdIdx: index("api_keys_tenant_id_idx").on(table.tenantId),
  })
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(), // ingest.started, ask.completed, provider.fallback, rls.violation, etc.
    tenantId: uuid("tenant_id").notNull(),
    payload: jsonb("payload").default({}).notNull(), // structured event data (latency, tokens, cost, errors)
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    tenantIdIdx: index("events_tenant_id_idx").on(table.tenantId),
    typeIdx: index("events_type_idx").on(table.type),
    createdAtIdx: index("events_created_at_idx").on(table.createdAt),
  })
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
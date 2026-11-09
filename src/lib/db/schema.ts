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
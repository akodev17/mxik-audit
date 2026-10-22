-- Records which provider produced the vectors currently in mxik_code.
-- Comparing embeddings from two different models is meaningless, so the vector
-- stage refuses to run when the query-time provider disagrees with this row.
CREATE TABLE IF NOT EXISTS "embedding_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "rowsEmbedded" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embedding_state_pkey" PRIMARY KEY ("id")
);

-- The ANN indexes were previously created out-of-band, which Prisma reported as
-- drift. Declaring them here (idempotently) puts them under migration control
-- without touching the 438,925 rows already loaded.
CREATE INDEX IF NOT EXISTS "mxik_code_embeddingUz_hnsw"
  ON "mxik_code" USING hnsw ("embeddingUz" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS "mxik_code_embeddingRu_hnsw"
  ON "mxik_code" USING hnsw ("embeddingRu" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

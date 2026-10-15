-- LLM rerank result cache. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
CREATE TABLE "rerank_cache" (
    "scope" TEXT NOT NULL,
    "key" CHAR(64) NOT NULL,
    "model" TEXT NOT NULL,
    "verdicts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rerank_cache_pkey" PRIMARY KEY ("scope", "key")
);

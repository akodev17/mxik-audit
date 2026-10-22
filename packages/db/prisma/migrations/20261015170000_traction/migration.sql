-- Traction metrics: an "internal" org kind (seed, perf and test orgs, never
-- counted) and a durable count of demo sessions (demo orgs are purged daily).
-- Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TYPE "org_kind" ADD VALUE IF NOT EXISTS 'internal';

CREATE TABLE "demo_visit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "demo_visit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "demo_visit_createdAt_idx" ON "demo_visit"("createdAt");

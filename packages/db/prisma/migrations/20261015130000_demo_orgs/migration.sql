-- Demo organizations: a seeded template and per-visitor throwaway copies. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
CREATE TYPE "org_kind" AS ENUM ('customer', 'demo_template', 'demo');

ALTER TABLE "organization"
    ADD COLUMN "kind" "org_kind" NOT NULL DEFAULT 'customer',
    ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "organization_kind_expiresAt_idx" ON "organization"("kind", "expiresAt");

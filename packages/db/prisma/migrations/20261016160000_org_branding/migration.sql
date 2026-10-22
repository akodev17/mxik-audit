-- Firm name and logo for white-label client PDF reports. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "organization" ADD COLUMN "brandName" TEXT,
    ADD COLUMN "logoData" BYTEA,
    ADD COLUMN "logoMime" TEXT;

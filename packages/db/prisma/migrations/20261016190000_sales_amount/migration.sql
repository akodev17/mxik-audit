-- Optional per-row sales amount, for the money-at-risk estimate. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "catalog_item" ADD COLUMN "salesAmount" DECIMAL(20,2);

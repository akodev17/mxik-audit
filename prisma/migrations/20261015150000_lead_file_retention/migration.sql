-- Records when a lead's uploaded file was erased (on request or by retention). Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "lead" ADD COLUMN "fileDeletedAt" TIMESTAMP(3);

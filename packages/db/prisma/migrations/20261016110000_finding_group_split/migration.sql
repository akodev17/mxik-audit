-- Lets a reviewer take a row out of its group of similar rows. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "finding" ADD COLUMN "groupSplit" BOOLEAN NOT NULL DEFAULT false;

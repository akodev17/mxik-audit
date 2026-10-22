-- Flags rows whose current or suggested code is marked for digital marking in
-- the classifier (label = 1), and backfills catalogues audited before this.
-- Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "catalog_item" ADD COLUMN "markingRequired" BOOLEAN NOT NULL DEFAULT false;

UPDATE "catalog_item" i SET "markingRequired" = true
WHERE (length(i."existingMxik") = 17 AND EXISTS (
        SELECT 1 FROM "mxik_code" m WHERE m.code = i."existingMxik"::char(17) AND m."isMarked"))
   OR EXISTS (
        SELECT 1 FROM "finding" f JOIN "mxik_code" m ON m.code = f."suggestedMxik"::char(17)
        WHERE f."itemId" = i.id AND length(f."suggestedMxik") = 17 AND m."isMarked");

CREATE INDEX "catalog_item_catalogId_markingRequired_idx" ON "catalog_item"("catalogId", "markingRequired");

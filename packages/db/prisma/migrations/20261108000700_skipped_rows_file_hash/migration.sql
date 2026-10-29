-- Export completeness (S8, F7 and F20): rows the commit skips (no name) keep their original cells in
-- their own table, so the corrected export has every file row in order while nothing that reads
-- catalog_item sees them; and the upload's SHA-256 for the "same file again" warning. Both new, no
-- backfill: catalogues committed before lost those rows, and their files were never hashed.
-- Rollback: docs/accounting-2026-10-23/migrations.md.
CREATE TABLE IF NOT EXISTS "catalog_skipped_row" (
    "catalogId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "original" JSONB NOT NULL,
    CONSTRAINT "catalog_skipped_row_pkey" PRIMARY KEY ("catalogId", "rowIndex"),
    CONSTRAINT "catalog_skipped_row_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "catalog" ADD COLUMN IF NOT EXISTS "fileHash" TEXT;
CREATE INDEX IF NOT EXISTS "catalog_orgId_fileHash_idx" ON "catalog"("orgId", "fileHash");

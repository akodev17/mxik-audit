-- A catalogue remembers the version of the same client it replaces. Additive only.
ALTER TABLE "catalog" ADD COLUMN "previousId" TEXT;
CREATE INDEX "catalog_previousId_idx" ON "catalog"("previousId");

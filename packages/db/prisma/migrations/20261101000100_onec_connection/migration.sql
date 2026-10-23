-- Agent 1 (1C integration): per-org 1C settings and direct connection, the stored export file and
-- the idempotency / duplicate-set keys of onec_export, and an index for per-record duplicate
-- detection across batches. Additive only.

-- CreateTable
CREATE TABLE IF NOT EXISTS "onec_connection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'none',
    "baseUrl" TEXT,
    "username" TEXT,
    "secret" TEXT,
    "objectMap" JSONB,
    "bankKeys" TEXT NOT NULL DEFAULT 'standard',
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastOk" BOOLEAN,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_connection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "onec_connection_orgId_key" ON "onec_connection"("orgId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "onec_connection" ADD CONSTRAINT "onec_connection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "onec_export" ADD COLUMN IF NOT EXISTS "file" BYTEA;
ALTER TABLE "onec_export" ADD COLUMN IF NOT EXISTS "contentType" TEXT;
ALTER TABLE "onec_export" ADD COLUMN IF NOT EXISTS "requestKey" TEXT;
ALTER TABLE "onec_export" ADD COLUMN IF NOT EXISTS "recordSetHash" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "onec_export_recordSetHash_idx" ON "onec_export"("recordSetHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_record_fingerprint_idx" ON "import_record"("fingerprint");

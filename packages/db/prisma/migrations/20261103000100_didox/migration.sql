-- Agent 3 (Didox invoices): the per-org Didox connection and the raw document cache. Additive
-- only; generated with `prisma migrate diff` from the base commit's schema and made idempotent
-- like 20261101000000_accounting_shared so it applies cleanly on the shared dev database.

-- CreateTable
CREATE TABLE IF NOT EXISTS "didox_connection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" TEXT NOT NULL,
    "companyTin" TEXT NOT NULL,
    "tokenSealed" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "partnerTokenRef" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "didox_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "didox_document" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "didoxId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "docType" TEXT,
    "status" TEXT,
    "json" JSONB NOT NULL,
    "pdf" BYTEA,
    "batchId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "didox_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "didox_connection_orgId_key" ON "didox_connection"("orgId");
CREATE INDEX IF NOT EXISTS "didox_document_batchId_idx" ON "didox_document"("batchId");
CREATE UNIQUE INDEX IF NOT EXISTS "didox_document_orgId_didoxId_key" ON "didox_document"("orgId", "didoxId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "didox_connection" ADD CONSTRAINT "didox_connection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "didox_document" ADD CONSTRAINT "didox_document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

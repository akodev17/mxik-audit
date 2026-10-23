-- Shared models of the accounting workflows (bank statements, Didox invoices, product catalogues
-- → 1C): import batches and their records, counterparties, 1C exports. Additive only; hand-authored
-- so it applies cleanly on the shared dev database (see README "Migrations").
DO $$ BEGIN CREATE TYPE "ImportKind" AS ENUM ('bank_statement', 'didox_invoice', 'product_catalog'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "ImportStatus" AS ENUM ('uploaded', 'parsed', 'review', 'approved', 'exported', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RecordStatus" AS ENUM ('valid', 'corrected', 'suspicious', 'unresolved', 'skipped', 'exported'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "import_batch" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" "ImportKind" NOT NULL,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "externalRef" TEXT,
    "fingerprint" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'uploaded',
    "counts" JSONB,
    "meta" JSONB,
    "error" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "import_record" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'valid',
    "payload" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "fingerprint" TEXT,
    "decision" JSONB,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "outcome" JSONB,

    CONSTRAINT "import_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "counterparty" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "inn" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "account" TEXT,
    "mfo" TEXT,
    "aliases" TEXT[],
    "onecRef" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "onec_export" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filename" TEXT,
    "recordCount" INTEGER NOT NULL,
    "outcome" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_export_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_batch_orgId_kind_createdAt_idx" ON "import_batch"("orgId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_batch_clientId_createdAt_idx" ON "import_batch"("clientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "import_batch_orgId_kind_fingerprint_key" ON "import_batch"("orgId", "kind", "fingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "import_record_batchId_status_idx" ON "import_record"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "import_record_batchId_rowIndex_key" ON "import_record"("batchId", "rowIndex");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "counterparty_orgId_inn_idx" ON "counterparty"("orgId", "inn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "counterparty_orgId_normalizedName_idx" ON "counterparty"("orgId", "normalizedName");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "counterparty_orgId_account_idx" ON "counterparty"("orgId", "account");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "onec_export_batchId_createdAt_idx" ON "onec_export"("batchId", "createdAt");

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_record" ADD CONSTRAINT "import_record_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty" ADD CONSTRAINT "counterparty_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparty" ADD CONSTRAINT "counterparty_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onec_export" ADD CONSTRAINT "onec_export_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;


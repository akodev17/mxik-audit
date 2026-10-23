-- CreateTable
CREATE TABLE "bank_format" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headerSignature" TEXT NOT NULL,
    "columnMap" JSONB NOT NULL,
    "conventions" JSONB NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_format_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_rule" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "cashFlowItem" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_format_orgId_headerSignature_key" ON "bank_format"("orgId", "headerSignature");

-- CreateIndex
CREATE INDEX "bank_rule_orgId_clientId_priority_idx" ON "bank_rule"("orgId", "clientId", "priority");

-- AddForeignKey
ALTER TABLE "bank_format" ADD CONSTRAINT "bank_format_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rule" ADD CONSTRAINT "bank_rule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rule" ADD CONSTRAINT "bank_rule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Application tables: organizations, users, catalogues, findings, audit log.
--
-- Authored via `prisma migrate diff` with the mxik_code statements removed.
-- Prisma's diff wants to drop this project's GIN trigram index, GIN array index,
-- both HNSW vector indexes, and the generated tsvector column, because its schema
-- language cannot express any of them. Never let it. See README "Migrations".

-- CreateEnum
CREATE TYPE "catalog_status" AS ENUM ('uploaded', 'analyzing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "finding_type" AS ENUM ('MISSING', 'NOT_FOUND', 'MISMATCH', 'UNIT_CONFLICT');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('high', 'medium');

-- CreateEnum
CREATE TYPE "decision" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateTable
CREATE TABLE "organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "columnMap" JSONB,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "status" "catalog_status" NOT NULL DEFAULT 'uploaded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "headers" TEXT[],
    "columnMap" JSONB NOT NULL,

    CONSTRAINT "catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_item" (
    "id" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "rawName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "barcode" TEXT,
    "existingMxik" TEXT,
    "unit" TEXT,
    "price" DECIMAL(18,2),
    "attrs" JSONB NOT NULL,

    CONSTRAINT "catalog_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "finding_type" NOT NULL,
    "severity" "severity" NOT NULL,
    "suggestedMxik" TEXT,
    "confidence" DOUBLE PRECISION,
    "alternatives" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "wasRetired" BOOLEAN NOT NULL DEFAULT false,
    "decision" "decision" NOT NULL DEFAULT 'pending',
    "chosenMxik" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_orgId_idx" ON "user"("orgId");

-- CreateIndex
CREATE INDEX "catalog_orgId_idx" ON "catalog"("orgId");

-- CreateIndex
CREATE INDEX "catalog_item_catalogId_idx" ON "catalog_item"("catalogId");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_item_catalogId_rowIndex_key" ON "catalog_item"("catalogId", "rowIndex");

-- CreateIndex
CREATE INDEX "finding_itemId_idx" ON "finding"("itemId");

-- CreateIndex
CREATE INDEX "finding_type_idx" ON "finding"("type");

-- CreateIndex
CREATE INDEX "finding_decision_idx" ON "finding"("decision");

-- CreateIndex
CREATE INDEX "audit_event_orgId_createdAt_idx" ON "audit_event"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog" ADD CONSTRAINT "catalog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_item" ADD CONSTRAINT "catalog_item_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding" ADD CONSTRAINT "finding_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "catalog_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

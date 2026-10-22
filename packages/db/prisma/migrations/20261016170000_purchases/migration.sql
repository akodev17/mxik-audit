-- Purchases ("Kirim") per client and the NOT_PURCHASED check. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
CREATE TYPE "client_activity" AS ENUM ('savdo', 'ishlab_chiqarish', 'boshqa');
ALTER TABLE "client" ADD COLUMN "activity" "client_activity" NOT NULL DEFAULT 'boshqa';

ALTER TYPE "finding_type" ADD VALUE IF NOT EXISTS 'NOT_PURCHASED';
ALTER TYPE "severity" ADD VALUE IF NOT EXISTS 'info';

CREATE TABLE "purchase_list" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "headers" TEXT[],
    "columnMap" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_list_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_list_orgId_idx" ON "purchase_list"("orgId");
CREATE INDEX "purchase_list_clientId_idx" ON "purchase_list"("clientId");
ALTER TABLE "purchase_list" ADD CONSTRAINT "purchase_list_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "purchase_item" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "name" TEXT,
    "mxik" TEXT,
    "unit" TEXT,
    "attrs" JSONB NOT NULL,
    CONSTRAINT "purchase_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "purchase_item_listId_idx" ON "purchase_item"("listId");
CREATE INDEX "purchase_item_mxik_idx" ON "purchase_item"("mxik");
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "purchase_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

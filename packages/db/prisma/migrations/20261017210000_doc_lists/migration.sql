-- Uploaded cheque lists and sales exports, their rows and the grouped findings. Additive only.
CREATE TABLE "doc_list" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "headers" TEXT[],
    "columnMap" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "progressDone" INTEGER NOT NULL DEFAULT 0,
    "progressTotal" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "doc_list_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "doc_list_clientId_kind_idx" ON "doc_list"("clientId", "kind");
CREATE INDEX "doc_list_orgId_idx" ON "doc_list"("orgId");
ALTER TABLE "doc_list" ADD CONSTRAINT "doc_list_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doc_list" ADD CONSTRAINT "doc_list_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "doc_item" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "name" TEXT,
    "mxik" TEXT,
    "unit" TEXT,
    "quantity" DECIMAL(20,3),
    "amount" DECIMAL(20,2),
    "occurredAt" DATE,
    "attrs" JSONB NOT NULL,
    CONSTRAINT "doc_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "doc_item_listId_idx" ON "doc_item"("listId");
ALTER TABLE "doc_item" ADD CONSTRAINT "doc_item_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "doc_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "doc_group" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "name" TEXT,
    "names" JSONB NOT NULL,
    "mxik" TEXT,
    "unit" TEXT,
    "lines" INTEGER NOT NULL,
    "quantity" DECIMAL(20,3),
    "amount" DECIMAL(20,2),
    "issues" TEXT[],
    "suggestedMxik" TEXT,
    "confidence" DOUBLE PRECISION,
    "detail" JSONB NOT NULL,
    CONSTRAINT "doc_group_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "doc_group_listId_idx" ON "doc_group"("listId");
ALTER TABLE "doc_group" ADD CONSTRAINT "doc_group_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "doc_list"("id") ON DELETE CASCADE ON UPDATE CASCADE;

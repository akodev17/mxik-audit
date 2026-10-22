-- Org-level dictionary learned from accepted decisions. Additive only.
ALTER TABLE "organization" ADD COLUMN "dictAutoAccept" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "firm_mapping" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT,
    "code" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staleAt" TIMESTAMP(3),
    CONSTRAINT "firm_mapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "firm_mapping_orgId_kind_key_key" ON "firm_mapping"("orgId", "kind", "key");
CREATE INDEX "firm_mapping_orgId_idx" ON "firm_mapping"("orgId");
ALTER TABLE "firm_mapping" ADD CONSTRAINT "firm_mapping_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

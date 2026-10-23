-- The monthly row allowance becomes a ledger: one entry per committed catalogue, kept when the
-- catalogue is deleted, so upload → delete → upload no longer gives the allowance back. Additive only.
-- Hand-authored for the same reason as 20261016180000_privileges (see README "Migrations").
CREATE TABLE IF NOT EXISTS "usage_ledger" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "catalogId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "usage_ledger_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "usage_ledger_catalogId_key_key" ON "usage_ledger"("catalogId", "key");
CREATE INDEX IF NOT EXISTS "usage_ledger_orgId_key_period_idx" ON "usage_ledger"("orgId", "key", "period");

-- Backfill: what usageOf counted until now (this UTC month's catalogues past "uploaded"), so no
-- org's usage drops at deploy. Timestamps are stored as UTC without a zone.
INSERT INTO "usage_ledger" ("id", "orgId", "key", "amount", "period", "catalogId", "reason", "createdAt")
SELECT 'backfill-' || c."id", c."orgId", 'rowsPerMonth', c."rowCount", date_trunc('month', c."createdAt"), c."id", 'backfill', c."createdAt"
FROM "catalog" c
WHERE c."status" <> 'uploaded'
  AND c."createdAt" >= date_trunc('month', now() AT TIME ZONE 'UTC')
ON CONFLICT ("catalogId", "key") DO NOTHING;

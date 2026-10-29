-- Orders outlive their org (S5, F20): purging an org sets "orgId" to null instead of deleting its
-- orders and their provider transactions; "orgName" keeps whose they were. "testMode" marks orders
-- paid through a provider's sandbox. Hand-authored and idempotent like 20261107000100_feature_flags.
-- Rollback: docs/accounting-2026-10-23/migrations.md.
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "orgName" TEXT;
ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "testMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "order" ALTER COLUMN "orgId" DROP NOT NULL;

-- Backfill: the name of the org each existing order belongs to.
UPDATE "order" o SET "orgName" = g."name" FROM "organization" g WHERE g."id" = o."orgId" AND o."orgName" IS NULL;

ALTER TABLE "order" DROP CONSTRAINT IF EXISTS "order_orgId_fkey";
ALTER TABLE "order" ADD CONSTRAINT "order_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

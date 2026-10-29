-- Dictionary safety and provenance (S4, plan F1/F9/F16/F17). New columns only, all nullable or
-- defaulted: the name key gains the size attributes (re-keyed by `npm run dictionary:rekey`, run once
-- per deploy after this migration), entries can need a fresh confirmation or be disputed, and a
-- carried-over decision keeps where and when it was first made.
-- Rollback: docs/accounting-2026-10-23/migrations.md.
ALTER TABLE "firm_mapping" ADD COLUMN IF NOT EXISTS "attrsKey" TEXT;
ALTER TABLE "firm_mapping" ADD COLUMN IF NOT EXISTS "needsReconfirm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "firm_mapping" ADD COLUMN IF NOT EXISTS "disputedAt" TIMESTAMP(3);
ALTER TABLE "firm_mapping" ADD COLUMN IF NOT EXISTS "disputedBy" TEXT;

ALTER TABLE "finding" ADD COLUMN IF NOT EXISTS "carriedFromCatalogId" TEXT;
ALTER TABLE "finding" ADD COLUMN IF NOT EXISTS "originalDecidedAt" TIMESTAMP(3);

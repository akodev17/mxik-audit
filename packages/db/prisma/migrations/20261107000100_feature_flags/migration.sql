-- Module flags (/admin/features): one row per module the owner switched; no row = ENABLED, so every
-- module stays as it was. No seed. Hand-authored and idempotent like 20261101000000_accounting_shared.
-- Rollback: docs/accounting-2026-10-23/migrations.md.
DO $$ BEGIN CREATE TYPE "feature_state" AS ENUM ('ENABLED', 'COMING_SOON', 'HIDDEN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "feature_flag" (
    "key" TEXT NOT NULL,
    "state" "feature_state" NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("key")
);

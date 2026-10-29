-- Audit lifecycle (S3, plan D7): a row whose check still failed after its retries keeps the error
-- here ("<kind>: <message>"); null = checked. No backfill: rows audited before had no such state.
-- Rollback: docs/accounting-2026-10-23/migrations.md.
ALTER TABLE "catalog_item" ADD COLUMN IF NOT EXISTS "checkError" TEXT;

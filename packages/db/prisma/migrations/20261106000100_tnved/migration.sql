-- TIF TN (TN VED) code per catalogue row, and the TNVED_MISMATCH finding. Additive only.
-- Hand-authored for the same reason as 20261016190000_sales_amount (see README "Migrations").
ALTER TYPE "finding_type" ADD VALUE IF NOT EXISTS 'TNVED_MISMATCH';

ALTER TABLE "catalog_item" ADD COLUMN IF NOT EXISTS "tnved" TEXT;

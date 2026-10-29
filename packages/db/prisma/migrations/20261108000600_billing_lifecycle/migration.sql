-- Refunds (S7, F15): scripts/billing-refund.ts marks an order refunded once the money was returned
-- by hand. Only a new enum value; no data change. Idempotent. Rollback: docs/accounting-2026-10-23/migrations.md.
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'refunded';

-- Onboarding tour (T1.1): when the user finished or skipped the guided tour; null = show it on the
-- next visit. No backfill (plan Q6): existing dev users see the tour once and can skip it.
-- Rollback: docs/accounting-2026-10-23/migrations.md.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "tourCompletedAt" TIMESTAMP(3);

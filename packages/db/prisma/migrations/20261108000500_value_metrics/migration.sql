-- Value metrics and onboarding (S9, plan D8 and F19): the minutes one decision would take by hand,
-- for the dashboard's "time saved" estimate (default 3, an admin sets 1 to 60), and when a person hid
-- the dashboard's checklist (it was a per-browser cookie). Defaulted or nullable: no backfill.
-- Rollback: docs/accounting-2026-10-23/migrations.md.
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "minutesPerDecision" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboardingHiddenAt" TIMESTAMP(3);

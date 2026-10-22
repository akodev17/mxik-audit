-- Generalized codes EHF refuses from a date on, and the RESTRICTED finding. Additive only.
-- Hand-authored for the same reason as 20261016180000_privileges (see README "Migrations").
ALTER TYPE "finding_type" ADD VALUE IF NOT EXISTS 'RESTRICTED';

CREATE TABLE IF NOT EXISTS "restricted_code" (
    "code" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "restricted_code_pkey" PRIMARY KEY ("code")
);

ALTER TABLE "finding" ADD COLUMN IF NOT EXISTS "restrictedMxik" TEXT;
ALTER TABLE "finding" ADD COLUMN IF NOT EXISTS "restrictedFrom" DATE;

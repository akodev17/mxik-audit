-- S1 (F2): how a user's e-mail address was confirmed. Google sign-in joins an existing account only
-- when its address was confirmed by a mailed code or link; accepting an invite no longer confirms it.
-- Backfill: every address confirmed before this column existed is 'legacy' (its origin is unknown).
-- Hand-authored and idempotent. Rollback: docs/accounting-2026-10-23/migrations.md.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "verifiedVia" TEXT;
UPDATE "user" SET "verifiedVia" = 'legacy' WHERE "emailVerifiedAt" IS NOT NULL AND "verifiedVia" IS NULL;

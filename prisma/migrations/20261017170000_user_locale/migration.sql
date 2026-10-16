-- A user's chosen interface language (uz or ru). Additive only.
ALTER TABLE "user" ADD COLUMN "locale" TEXT;

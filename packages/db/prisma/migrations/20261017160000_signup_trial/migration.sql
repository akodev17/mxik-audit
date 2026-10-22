-- Self-serve signup: trial end, email verification, Telegram login. Additive only.
ALTER TABLE "organization" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
-- Existing customer orgs get the same 14 days, counted from this migration.
UPDATE "organization" SET "trialEndsAt" = now() + interval '14 days' WHERE "kind" = 'customer';

ALTER TABLE "user" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
UPDATE "user" SET "emailVerifiedAt" = "createdAt";

CREATE TABLE "email_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_token_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "email_token_tokenHash_key" ON "email_token"("tokenHash");
ALTER TABLE "email_token" ADD CONSTRAINT "email_token_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

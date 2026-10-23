-- E-mail verification codes and Google sign-in. Additive only: a new table and a nullable unique column.
CREATE TABLE IF NOT EXISTS "email_code" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_code_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_code_userId_createdAt_idx" ON "email_code"("userId", "createdAt");

DO $$ BEGIN
    ALTER TABLE "email_code" ADD CONSTRAINT "email_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "googleSub" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "user_googleSub_key" ON "user"("googleSub");

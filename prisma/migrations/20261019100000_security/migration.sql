-- Two-factor sign-in, server-side sessions, account soft delete and raw-file retention. Additive only.
ALTER TABLE "user" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "user" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "user" ADD COLUMN "totpLastStep" INTEGER;

CREATE TABLE "recovery_code" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "recovery_code_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "recovery_code_userId_idx" ON "recovery_code"("userId");
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "user_session_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "user_session_userId_idx" ON "user_session"("userId");
ALTER TABLE "user_session" ADD CONSTRAINT "user_session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- deletedAt = account closed (restorable until it is purged); rawRetentionDays null = keep uploaded cells.
ALTER TABLE "organization" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "organization" ADD COLUMN "rawRetentionDays" INTEGER DEFAULT 30;
ALTER TABLE "catalog" ADD COLUMN "rawPurgedAt" TIMESTAMP(3);
ALTER TABLE "purchase_list" ADD COLUMN "rawPurgedAt" TIMESTAMP(3);
ALTER TABLE "doc_list" ADD COLUMN "rawPurgedAt" TIMESTAMP(3);

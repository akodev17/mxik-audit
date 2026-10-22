-- Public API keys (only a hash of the token is stored) and monthly call counts per key. Additive only.
CREATE TABLE "api_key" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_key_tokenHash_key" ON "api_key"("tokenHash");
CREATE INDEX "api_key_orgId_idx" ON "api_key"("orgId");
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "api_usage" (
    "keyId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("keyId", "month")
);
CREATE INDEX "api_usage_orgId_month_idx" ON "api_usage"("orgId", "month");
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_keyId_fkey"
    FOREIGN KEY ("keyId") REFERENCES "api_key"("id") ON DELETE CASCADE ON UPDATE CASCADE;

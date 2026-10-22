-- Requests for demo access: who asked, the hashed single-use link, and the demo copy it opened.
-- Additive only. No foreign key to the demo org: the org is purged after the demo ends, the request
-- row stays (without personal data being sent anywhere) until the retention job removes it.

CREATE TABLE "demo_request" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "useCase" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "orgId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_request_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "demo_request_tokenHash_key" ON "demo_request"("tokenHash");
CREATE INDEX "demo_request_emailKey_createdAt_idx" ON "demo_request"("emailKey", "createdAt");
CREATE INDEX "demo_request_createdAt_idx" ON "demo_request"("createdAt");

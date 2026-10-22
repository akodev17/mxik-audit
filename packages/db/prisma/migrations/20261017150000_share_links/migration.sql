-- Read-only report links for a client. Only the hash of the token is stored. Additive only.
CREATE TABLE "share_link" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "includePdf" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "views" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    CONSTRAINT "share_link_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "share_link_tokenHash_key" ON "share_link"("tokenHash");
CREATE INDEX "share_link_catalogId_idx" ON "share_link"("catalogId");
CREATE INDEX "share_link_orgId_idx" ON "share_link"("orgId");
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "share_link" ADD CONSTRAINT "share_link_catalogId_fkey"
    FOREIGN KEY ("catalogId") REFERENCES "catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

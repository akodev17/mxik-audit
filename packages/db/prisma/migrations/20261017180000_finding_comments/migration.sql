-- Per-row notes thread. Never shown on share links. Additive only.
CREATE TABLE "finding_comment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "finding_comment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "finding_comment_findingId_createdAt_idx" ON "finding_comment"("findingId", "createdAt");
CREATE INDEX "finding_comment_orgId_idx" ON "finding_comment"("orgId");
ALTER TABLE "finding_comment" ADD CONSTRAINT "finding_comment_findingId_fkey"
    FOREIGN KEY ("findingId") REFERENCES "finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finding_comment" ADD CONSTRAINT "finding_comment_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- "Taklif notoʻgʻri": why a reviewer says a suggestion was wrong. Additive only.
CREATE TABLE "suggestion_feedback" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "stage" TEXT,
    "label" TEXT,
    "suggestedMxik" TEXT,
    "productName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suggestion_feedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "suggestion_feedback_findingId_key" ON "suggestion_feedback"("findingId");
CREATE INDEX "suggestion_feedback_orgId_createdAt_idx" ON "suggestion_feedback"("orgId", "createdAt");
ALTER TABLE "suggestion_feedback" ADD CONSTRAINT "suggestion_feedback_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

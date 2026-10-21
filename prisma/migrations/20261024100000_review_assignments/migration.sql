-- Review assignments (a catalogue review handed to a team member) and notifications addressed to one
-- person or deduplicated by the event that raised them. Additive only: existing rows are untouched.

CREATE TYPE "review_status" AS ENUM ('open', 'done');

CREATE TABLE "review_assignment" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "createdBy" TEXT,
    "dueOn" DATE,
    "note" TEXT,
    "status" "review_status" NOT NULL DEFAULT 'open',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "doneAt" TIMESTAMP(3),
    "doneBy" TEXT,
    "doneNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_assignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "review_assignment_catalogId_key" ON "review_assignment"("catalogId");
CREATE INDEX "review_assignment_orgId_status_dueOn_idx" ON "review_assignment"("orgId", "status", "dueOn");
CREATE INDEX "review_assignment_assigneeId_status_idx" ON "review_assignment"("assigneeId", "status");
CREATE INDEX "review_assignment_clientId_idx" ON "review_assignment"("clientId");

ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification" ADD COLUMN "userId" TEXT;
ALTER TABLE "notification" ADD COLUMN "dedupeKey" TEXT;
-- Postgres treats NULLs as distinct, so notices without a key are never deduplicated.
CREATE UNIQUE INDEX "notification_orgId_dedupeKey_key" ON "notification"("orgId", "dedupeKey");
CREATE INDEX "notification_userId_idx" ON "notification"("userId");
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Classifier update tracking: per-snapshot diff, findings caused by an update,
-- and notifications. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
CREATE TYPE "classifier_change_kind" AS ENUM ('added', 'retired', 'unit_changed', 'name_changed');

ALTER TABLE "catalog_snapshot"
    ADD COLUMN "addedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "retiredCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "unitChangedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "nameChangedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "recheckedAt" TIMESTAMP(3);

CREATE TABLE "classifier_change" (
    "id" SERIAL NOT NULL,
    "snapshotId" INTEGER NOT NULL,
    "code" CHAR(17) NOT NULL,
    "kind" "classifier_change_kind" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    CONSTRAINT "classifier_change_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "classifier_change_snapshotId_kind_idx" ON "classifier_change"("snapshotId", "kind");
CREATE INDEX "classifier_change_code_idx" ON "classifier_change"("code");
ALTER TABLE "classifier_change" ADD CONSTRAINT "classifier_change_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "catalog_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "finding" ADD COLUMN "snapshotId" INTEGER;

CREATE TABLE "notification" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "telegramSentAt" TIMESTAMP(3),
    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "notification_orgId_createdAt_idx" ON "notification"("orgId", "createdAt");
CREATE INDEX "notification_clientId_createdAt_idx" ON "notification"("clientId", "createdAt");
ALTER TABLE "notification" ADD CONSTRAINT "notification_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification" ADD CONSTRAINT "notification_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

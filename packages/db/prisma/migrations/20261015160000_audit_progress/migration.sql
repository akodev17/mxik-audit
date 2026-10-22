-- Background audits: progress, heartbeat and error per catalogue. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "catalog"
    ADD COLUMN "progressDone" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "auditStartedAt" TIMESTAMP(3),
    ADD COLUMN "auditHeartbeatAt" TIMESTAMP(3),
    ADD COLUMN "auditError" TEXT;

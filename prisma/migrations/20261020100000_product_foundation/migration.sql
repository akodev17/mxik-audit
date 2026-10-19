-- Foundation for the product pass: per-user notification reads, audit provenance,
-- client lifecycle, auth hardening, import metadata, API idempotency. Additive only.

-- Notifications: read state per user instead of one org-wide readAt.
CREATE TABLE "notification_read" (
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_read_pkey" PRIMARY KEY ("userId", "notificationId")
);
CREATE INDEX "notification_read_notificationId_idx" ON "notification_read"("notificationId");
ALTER TABLE "notification_read" ADD CONSTRAINT "notification_read_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_read" ADD CONSTRAINT "notification_read_notificationId_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Catalogue: which classifier snapshot the audit used, how the pipeline ran, what the import saw.
ALTER TABLE "catalog" ADD COLUMN "snapshotId" INTEGER;
ALTER TABLE "catalog" ADD COLUMN "pipelineMeta" JSONB;
ALTER TABLE "catalog" ADD COLUMN "importMeta" JSONB;

-- Finding: where the current decision came from (manual, group, bulk, bulk_sure, dictionary, dictionary_auto, carry_over).
ALTER TABLE "finding" ADD COLUMN "decisionSource" TEXT;

-- Firm dictionary: how many individual confirmations back an entry, and how it was learned.
ALTER TABLE "firm_mapping" ADD COLUMN "confirmations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "firm_mapping" ADD COLUMN "source" TEXT;

-- Clients can be archived instead of deleted.
ALTER TABLE "client" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Auth: platform operators by flag, personal Telegram login binding, token purpose.
ALTER TABLE "user" ADD COLUMN "platformAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user" ADD COLUMN "telegramUserId" TEXT;
CREATE UNIQUE INDEX "user_telegramUserId_key" ON "user"("telegramUserId");
ALTER TABLE "email_token" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'verify';

-- Rate limiting that survives restarts and spans instances.
CREATE TABLE "auth_attempt" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_attempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auth_attempt_kind_key_createdAt_idx" ON "auth_attempt"("kind", "key", "createdAt");

-- Raw-file retention applies only to uploads made after the policy existed for the org.
ALTER TABLE "organization" ADD COLUMN "rawRetentionSince" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "organization" SET "rawRetentionSince" = CURRENT_TIMESTAMP WHERE "rawRetentionSince" IS NULL;

-- Import metadata for purchase and doc lists (headers sample, truncation, diagnostics).
ALTER TABLE "purchase_list" ADD COLUMN "meta" JSONB;
ALTER TABLE "doc_list" ADD COLUMN "meta" JSONB;

-- Public API idempotency: a repeated Idempotency-Key returns the first response.
CREATE TABLE "api_idempotency" (
    "keyId" TEXT NOT NULL,
    "idemKey" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_idempotency_pkey" PRIMARY KEY ("keyId", "idemKey")
);
ALTER TABLE "api_idempotency" ADD CONSTRAINT "api_idempotency_keyId_fkey"
    FOREIGN KEY ("keyId") REFERENCES "api_key"("id") ON DELETE CASCADE ON UPDATE CASCADE;

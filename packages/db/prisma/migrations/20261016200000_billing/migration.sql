-- Orders, Click/Payme transactions and the firm subscription. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "organization" ADD COLUMN "subscriptionUntil" TIMESTAMP(3);

CREATE TYPE "order_status" AS ENUM ('created', 'paid', 'cancelled');

CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "catalogId" TEXT,
    "planId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'created',
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "order_orgId_createdAt_idx" ON "order"("orgId", "createdAt");
CREATE INDEX "order_catalogId_idx" ON "order"("catalogId");
ALTER TABLE "order" ADD CONSTRAINT "order_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payment_transaction" (
    "id" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "state" INTEGER NOT NULL,
    "providerTime" BIGINT,
    "createTime" BIGINT NOT NULL,
    "performTime" BIGINT,
    "cancelTime" BIGINT,
    "reason" INTEGER,
    CONSTRAINT "payment_transaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_transaction_provider_externalId_key" ON "payment_transaction"("provider", "externalId");
CREATE INDEX "payment_transaction_orderId_idx" ON "payment_transaction"("orderId");
ALTER TABLE "payment_transaction" ADD CONSTRAINT "payment_transaction_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

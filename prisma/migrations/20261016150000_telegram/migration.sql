-- Telegram bot: linked chats, one-time link codes, files awaiting a client
-- choice, and the chat a bot-uploaded catalogue reports back to. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TABLE "catalog" ADD COLUMN "telegramChatId" TEXT;

CREATE TABLE "telegram_link" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "linkedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_link_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "telegram_link_chatId_key" ON "telegram_link"("chatId");
CREATE INDEX "telegram_link_orgId_idx" ON "telegram_link"("orgId");
ALTER TABLE "telegram_link" ADD CONSTRAINT "telegram_link_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "telegram_link_code" (
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_link_code_pkey" PRIMARY KEY ("code")
);
CREATE INDEX "telegram_link_code_orgId_idx" ON "telegram_link_code"("orgId");

CREATE TABLE "telegram_pending" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "telegram_pending_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "telegram_pending_chatId_idx" ON "telegram_pending"("chatId");

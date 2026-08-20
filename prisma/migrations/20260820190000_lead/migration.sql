-- Landing-page free-audit requests.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
CREATE TABLE "lead" (
    "id" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "company" TEXT,
    "filename" TEXT,
    "fileBytes" INTEGER,
    "rowGuess" INTEGER,
    "fileData" BYTEA,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_createdAt_idx" ON "lead"("createdAt");

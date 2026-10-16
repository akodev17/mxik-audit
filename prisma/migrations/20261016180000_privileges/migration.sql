-- Tax-privilege reference and the two privilege findings. Additive only.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
ALTER TYPE "finding_type" ADD VALUE IF NOT EXISTS 'PRIVILEGE_CODE';
ALTER TYPE "finding_type" ADD VALUE IF NOT EXISTS 'PRIVILEGE_OPPORTUNITY';

CREATE TABLE "tax_privilege" (
    "id" TEXT NOT NULL,
    "nameLatn" TEXT,
    "nameRu" TEXT,
    "docNum" INTEGER,
    "docDate" TIMESTAMP(3),
    "docNameLatn" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_privilege_pkey" PRIMARY KEY ("id")
);

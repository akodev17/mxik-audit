-- Team roles, client assignments and invites. Additive only; every existing user becomes an admin.
CREATE TYPE "user_role" AS ENUM ('admin', 'accountant', 'viewer');
ALTER TABLE "user" ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'admin';

CREATE TABLE "client_assignment" (
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_assignment_pkey" PRIMARY KEY ("userId", "clientId")
);
CREATE INDEX "client_assignment_clientId_idx" ON "client_assignment"("clientId");
ALTER TABLE "client_assignment" ADD CONSTRAINT "client_assignment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_assignment" ADD CONSTRAINT "client_assignment_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT,
    "role" "user_role" NOT NULL,
    "clientIds" TEXT[],
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "invite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invite_tokenHash_key" ON "invite"("tokenHash");
CREATE INDEX "invite_orgId_idx" ON "invite"("orgId");
ALTER TABLE "invite" ADD CONSTRAINT "invite_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

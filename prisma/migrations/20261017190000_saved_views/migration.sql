-- Named workspace views per user. Additive only.
CREATE TABLE "saved_view" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "saved_view_userId_idx" ON "saved_view"("userId");
CREATE UNIQUE INDEX "saved_view_one_default" ON "saved_view"("userId") WHERE "isDefault";
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

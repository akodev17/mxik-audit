-- Organization -> Client -> Catalog. Non-destructive: every org gets one
-- default client (named after the org) and its existing catalogues move there.
-- A trigger fills the default client for any insert that omits it, so callers
-- that predate clients (scripts, older builds) keep working.
-- Hand-authored: `prisma migrate diff` wants to drop this project's GIN trigram
-- index, GIN array index, both HNSW vector indexes and the generated tsvector
-- column, none of which its schema language can express. See README "Migrations".
CREATE TABLE "client" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "client_orgId_idx" ON "client"("orgId");
CREATE UNIQUE INDEX "client_one_default_per_org" ON "client"("orgId") WHERE "isDefault";
ALTER TABLE "client" ADD CONSTRAINT "client_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "client" ("id", "orgId", "name", "isDefault", "createdAt")
SELECT 'cl' || md5(o.id), o.id, o.name, true, o."createdAt" FROM "organization" o;

ALTER TABLE "catalog" ADD COLUMN "clientId" TEXT;
UPDATE "catalog" c SET "clientId" = cl.id
FROM "client" cl WHERE cl."orgId" = c."orgId" AND cl."isDefault";
ALTER TABLE "catalog" ALTER COLUMN "clientId" SET NOT NULL;
ALTER TABLE "catalog" ADD CONSTRAINT "catalog_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "catalog_clientId_createdAt_idx" ON "catalog"("clientId", "createdAt");

CREATE FUNCTION "catalog_default_client"() RETURNS trigger AS $$
BEGIN
  IF NEW."clientId" IS NULL THEN
    INSERT INTO "client" ("id", "orgId", "name", "isDefault")
    SELECT 'cl' || md5(o.id), o.id, o.name, true FROM "organization" o WHERE o.id = NEW."orgId"
    ON CONFLICT ("orgId") WHERE "isDefault" DO NOTHING;
    SELECT id INTO NEW."clientId" FROM "client" WHERE "orgId" = NEW."orgId" AND "isDefault";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER "catalog_default_client" BEFORE INSERT ON "catalog"
    FOR EACH ROW EXECUTE FUNCTION "catalog_default_client"();

-- Agent 4 (product catalogue and MXIK intelligence): products and their aliases, Tasnif packaging
-- codes fetched on demand, and the live API's activity state per classifier code. Additive only.

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "unitKey" TEXT NOT NULL DEFAULT '',
    "onecRef" TEXT,
    "mxik" CHAR(17),
    "mxikName" TEXT,
    "packageCode" TEXT,
    "packageName" TEXT,
    "unit" TEXT,
    "barcode" TEXT,
    "source" TEXT NOT NULL,
    "mxikStatus" TEXT NOT NULL DEFAULT 'unchecked',
    "mxikIssues" JSONB,
    "mxikSuggestion" JSONB,
    "mxikCheckedAt" TIMESTAMP(3),
    "mxikConfirmedAt" TIMESTAMP(3),
    "mxikConfirmedBy" TEXT,
    "markingRequired" BOOLEAN,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_alias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_alias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_code" (
    "code" TEXT NOT NULL,
    "mxikCode" CHAR(17) NOT NULL,
    "parentCode" TEXT,
    "containerCode" INTEGER,
    "containerName" TEXT,
    "unitId" INTEGER,
    "unitName" TEXT,
    "parentValue" DOUBLE PRECISION,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "isUnitPackage" TEXT,
    "nameUz" TEXT,
    "nameRu" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "packaging_code_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "mxik_code_state" (
    "code" CHAR(17) NOT NULL,
    "isActive" BOOLEAN,
    "apiStatus" INTEGER,
    "apiNotFound" BOOLEAN NOT NULL DEFAULT false,
    "statusFetchedAt" TIMESTAMP(3),
    "packagesFetchedAt" TIMESTAMP(3),
    "packageCount" INTEGER,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mxik_code_state_pkey" PRIMARY KEY ("code")
);
-- CreateIndex
CREATE INDEX "product_orgId_clientId_idx" ON "product"("orgId", "clientId");
-- CreateIndex
CREATE INDEX "product_orgId_mxik_idx" ON "product"("orgId", "mxik");
-- CreateIndex
CREATE INDEX "product_orgId_barcode_idx" ON "product"("orgId", "barcode");
-- CreateIndex
CREATE INDEX "product_orgId_onecRef_idx" ON "product"("orgId", "onecRef");
-- CreateIndex
CREATE INDEX "product_orgId_mxikStatus_idx" ON "product"("orgId", "mxikStatus");
-- CreateIndex
CREATE INDEX "product_alias_orgId_normalizedAlias_idx" ON "product_alias"("orgId", "normalizedAlias");
-- CreateIndex
CREATE UNIQUE INDEX "product_alias_productId_normalizedAlias_key" ON "product_alias"("productId", "normalizedAlias");
-- CreateIndex
CREATE INDEX "packaging_code_mxikCode_idx" ON "packaging_code"("mxikCode");
-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "product_alias" ADD CONSTRAINT "product_alias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Identity of a product within the org and client (a null client is the org's own catalogue).
CREATE UNIQUE INDEX "product_identity_key" ON "product"("orgId", (COALESCE("clientId", '')), "normalizedName", "unitKey");

-- Name similarity for matchProducts (bounded pg_trgm search within the org).
CREATE INDEX "product_normalizedName_trgm_idx" ON "product" USING gin ("normalizedName" gin_trgm_ops);

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "unit_binding" AS ENUM ('strict', 'recommended', 'none');

-- CreateTable
CREATE TABLE "mxik_code" (
    "code" CHAR(17) NOT NULL,
    "groupCode" CHAR(3) NOT NULL,
    "classCode" CHAR(5) NOT NULL,
    "positionCode" CHAR(8) NOT NULL,
    "subPositionCode" CHAR(11) NOT NULL,
    "brandCode" CHAR(14) NOT NULL,
    "nameUz" TEXT NOT NULL,
    "nameRu" TEXT NOT NULL,
    "nameUzCyrl" TEXT NOT NULL,
    "groupNameUz" TEXT,
    "groupNameRu" TEXT,
    "groupNameUzCyrl" TEXT,
    "classNameUz" TEXT,
    "classNameRu" TEXT,
    "classNameUzCyrl" TEXT,
    "positionNameUz" TEXT,
    "positionNameRu" TEXT,
    "positionNameUzCyrl" TEXT,
    "subPositionNameUz" TEXT,
    "subPositionNameRu" TEXT,
    "subPositionNameUzCyrl" TEXT,
    "brandNameUz" TEXT,
    "brandNameRu" TEXT,
    "brandNameUzCyrl" TEXT,
    "attributeNameUz" TEXT,
    "attributeNameRu" TEXT,
    "attributeNameUzCyrl" TEXT,
    "barcode" CHAR(14),
    "unitRaw" TEXT,
    "unitCanonical" TEXT[],
    "unitIds" INTEGER[],
    "unitContainer" TEXT,
    "unitQuantity" DOUBLE PRECISION,
    "unitBinding" "unit_binding" NOT NULL,
    "recommendedUnits" TEXT[],
    "recommendedUnitGroups" TEXT[],
    "packagesRaw" TEXT,
    "taxPrivilegeIds" TEXT[],
    "isBase" BOOLEAN NOT NULL,
    "isMarked" BOOLEAN,
    "matchKeys" TEXT[],
    "searchText" TEXT NOT NULL,
    "embeddingUz" vector(384),
    "embeddingRu" vector(384),
    "retiredAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mxik_code_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "catalog_snapshot" (
    "id" SERIAL NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "codeCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "retiredCodes" TEXT[],

    CONSTRAINT "catalog_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mxik_code_barcode_idx" ON "mxik_code"("barcode");

-- CreateIndex
CREATE INDEX "mxik_code_subPositionCode_idx" ON "mxik_code"("subPositionCode");

-- CreateIndex
CREATE INDEX "mxik_code_groupCode_idx" ON "mxik_code"("groupCode");

-- CreateIndex
CREATE INDEX "mxik_code_isBase_idx" ON "mxik_code"("isBase");

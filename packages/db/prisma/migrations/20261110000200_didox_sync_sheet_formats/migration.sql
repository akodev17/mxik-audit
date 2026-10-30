-- Didox (documents S2, 30 Oct 2026): the background sync's state and Didox's own error words on the
-- connection, and the ЭСФ spreadsheet column mappings an org confirmed.
ALTER TABLE "didox_connection" ADD COLUMN "lastErrorDetail" TEXT;
ALTER TABLE "didox_connection" ADD COLUMN "syncState" JSONB;

CREATE TABLE "didox_sheet_format" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "headerSignature" TEXT NOT NULL,
    "columnMap" JSONB NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "didox_sheet_format_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "didox_sheet_format_orgId_headerSignature_key" ON "didox_sheet_format"("orgId", "headerSignature");

ALTER TABLE "didox_sheet_format" ADD CONSTRAINT "didox_sheet_format_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

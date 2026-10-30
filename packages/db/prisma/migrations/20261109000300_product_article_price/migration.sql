-- Product catalogue on real files (S3, docs/DOCUMENTS_REAL_DATA_PLAN_2026-10-30.md): the import kept
-- the Артикул column in its mapping and then dropped it (B7), so the 1C nomenclature file always had
-- an empty «Артикул». The product now keeps it, and the selling price and VAT rate the file states
-- (1C «Цена», «Ставка НДС»). All nullable, no backfill: earlier imports never stored them.
-- price: the file's price rounded to tiyin; priceIncludesVat: true = the price column said "с НДС",
-- false = "без НДС", null = it did not say; vatRate: "12" / "0" / "15" or "without" (Без НДС).
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "article" TEXT;
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "price" DECIMAL(18,2);
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "priceIncludesVat" BOOLEAN;
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "vatRate" TEXT;
CREATE INDEX IF NOT EXISTS "product_orgId_article_idx" ON "product"("orgId", "article");

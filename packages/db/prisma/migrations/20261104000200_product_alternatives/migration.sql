-- Agent 4: the runner-up codes of a product's last classification, shown in the product drawer.
ALTER TABLE "product" ADD COLUMN IF NOT EXISTS "mxikAlternatives" JSONB;

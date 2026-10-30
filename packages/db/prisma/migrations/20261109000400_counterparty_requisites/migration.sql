-- Counterparty requisites of the Uzbek 1C (S4, research note onec §1.4, checklist §8.13–16): the
-- kind (legal entity by 9-digit ИНН, individual by 14-digit ПИНФЛ, non-resident without ИНН), the
-- branch code (1C UZ 3.0.62 tells counterparties apart by ИНН + код филиала) and the 12-digit VAT
-- registration code. All nullable, no backfill: existing rows keep matching by ИНН as before.
-- Rollback: ALTER TABLE "counterparty" DROP COLUMN "kind", DROP COLUMN "branchCode", DROP COLUMN "vatCode";
ALTER TABLE "counterparty" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "counterparty" ADD COLUMN IF NOT EXISTS "branchCode" TEXT;
ALTER TABLE "counterparty" ADD COLUMN IF NOT EXISTS "vatCode" TEXT;

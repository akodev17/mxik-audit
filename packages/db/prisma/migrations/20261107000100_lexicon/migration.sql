-- The learned lexicon (docs/MATCHING_V2_PLAN.md §11). Additive only; hand-authored for the same
-- reason as 20261016190000_sales_amount (see README "Migrations").
--
-- learned_alias: per organisation, which code it confirmed for a normalised product name, from
-- individual and group decisions only (bulk accepts are never counted). Aggregated across
-- organisations into global alias candidates; nothing here changes matching by itself.
CREATE TABLE IF NOT EXISTS "learned_alias" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learned_alias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "learned_alias_orgId_key_code_key" ON "learned_alias"("orgId", "key", "code");
CREATE INDEX IF NOT EXISTS "learned_alias_key_idx" ON "learned_alias"("key");

ALTER TABLE "learned_alias" ADD CONSTRAINT "learned_alias_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- lexicon_entry: what a platform admin manages on /admin/lexicon. kind = synonym (a
-- normalize/synonyms.ts entry as JSON), unit (a unit alias: alias → official unit) or alias (an
-- approved or rejected global alias: key, code, label). status = active | disabled | rejected.
-- Only active rows are merged with the file tables at load time.
CREATE TABLE IF NOT EXISTS "lexicon_entry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lexicon_entry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "lexicon_entry_kind_key_key" ON "lexicon_entry"("kind", "key");
CREATE INDEX IF NOT EXISTS "lexicon_entry_kind_status_idx" ON "lexicon_entry"("kind", "status");

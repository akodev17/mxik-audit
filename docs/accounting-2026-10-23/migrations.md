# Migration rollback guide (since `20261027100000`)

QA FAIL-3 / Q11. Every migration since `20261027100000` with the SQL that undoes it, the
`_prisma_migrations` row to delete so `prisma migrate deploy` would apply it again, and what breaks
while it is rolled back. Agent 5 keeps this file; each workstream's section is filled in Phase C
from the migrations that land on its branch.

## How to roll back

1. **Back up first** (DEPLOY.md 9): `docker compose exec db pg_dump -U mxik -Fc mxik > before-rollback.dump`.
2. **Stop the code that needs the migration** (deploy the previous image of api, worker and web).
   Code newer than the schema fails on the first query that touches a dropped table or column.
3. Run the rollback SQL of each migration, **newest first**, in one transaction per migration:
   `docker compose exec -T db psql -U mxik -d mxik -v ON_ERROR_STOP=1 -1 -f rollback.sql`.
4. Delete the migration's row so the history matches the schema:
   `DELETE FROM "_prisma_migrations" WHERE migration_name = '<folder name>';`
5. `npx prisma migrate status --schema packages/db/prisma/schema.prisma` lists the rolled-back
   migrations as "not yet applied"; the next `prisma migrate deploy` (the api container runs it at
   start) applies them again, so do not start a newer image until you mean to.

Never use `prisma migrate reset` or `migrate dev` on a shared or production database. All migrations
below are additive (new tables, nullable columns, indexes, backfilled rows), so rolling one back
loses only the data written into what it created.

## Base programme (before the accounting workstreams)

### `20261027100000_email_code_google`

E-mail verification codes (`email_code`) and Google sign-in (`user.googleSub`).

```sql
DROP TABLE IF EXISTS "email_code";
DROP INDEX IF EXISTS "user_googleSub_key";
ALTER TABLE "user" DROP COLUMN IF EXISTS "googleSub";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261027100000_email_code_google';
```

What breaks: password sign-up cannot send or check the 6-digit code (the code step and resend answer
500), so new accounts stay unconfirmed and see only the code step; accounts already confirmed keep
working. Google sign-in fails and every Google-linked account loses the link (the users can still
reset a password by e-mail). Outstanding codes are lost (a resend after re-applying issues new ones).

### `20261027100000_usage_ledger`

The monthly row allowance as a ledger (`usage_ledger`), with a backfill of the month's committed catalogues.

```sql
DROP TABLE IF EXISTS "usage_ledger";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261027100000_usage_ledger';
```

What breaks: **K2 comes back with the old code**: deleting a catalogue gives its rows back to the
monthly allowance (upload, delete, upload passes the trial's cap). Code that expects the table
fails on every commit and on `GET /api/billing/plan`. Re-applying backfills only the current UTC
month's catalogues that still exist, so rows of catalogues deleted in between are not counted again.

### `20261027130000_notification_text`

Notifications in every interface language (`notification.text`, JSONB).

```sql
ALTER TABLE "notification" DROP COLUMN IF EXISTS "text";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261027130000_notification_text';
```

What breaks: notifications written since the migration lose their per-language text and show the
stored `title`/`body` (the language of the moment they were written); readers fall back by design.
Code that writes `text` fails to create notifications until it is rolled back too.

### `20261101000000_accounting_shared`

The accounting contracts' shared tables (Agent 1's base commit): enums `ImportKind`, `ImportStatus`,
`RecordStatus`; tables `import_batch`, `import_record`, `counterparty`, `onec_export`.

```sql
DROP TABLE IF EXISTS "onec_export";
DROP TABLE IF EXISTS "import_record";
DROP TABLE IF EXISTS "counterparty";
DROP TABLE IF EXISTS "import_batch";
DROP TYPE IF EXISTS "RecordStatus";
DROP TYPE IF EXISTS "ImportStatus";
DROP TYPE IF EXISTS "ImportKind";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261101000000_accounting_shared';
```

What breaks: every bank, Didox, product-catalogue import and 1C export is lost with its records and
the counterparty directory. Roll back every workstream migration that references these tables first
(sections below). On the base commit the module pages are placeholders, so nothing else depends on them.

## Agent 1: 1C integration core (`202611010*`)

### `20261101000100_onec_connection`

Adds `onec_connection` (per-org 1C settings and sealed direct-connection credentials), four nullable columns on `onec_export` (the stored file, its content type, the idempotency request key and record-set hash) and two indexes.

```sql
DROP INDEX IF EXISTS "import_record_fingerprint_idx";
DROP INDEX IF EXISTS "onec_export_recordSetHash_idx";
ALTER TABLE "onec_export" DROP COLUMN IF EXISTS "recordSetHash", DROP COLUMN IF EXISTS "requestKey", DROP COLUMN IF EXISTS "contentType", DROP COLUMN IF EXISTS "file";
DROP TABLE IF EXISTS "onec_connection";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261101000100_onec_connection';
```

What breaks: every stored 1C file is lost (exports can be rebuilt from their batches), the idempotent repeat of an export no longer finds the earlier one, and every org's 1C connection settings are gone.


## Agent 2: bank statements (`202611020*`)

### `20261102000100_bank_formats_rules`

Adds `bank_format` (remembered column mappings per org and header signature) and `bank_rule` (operation rules per org or client).

```sql
DROP TABLE IF EXISTS "bank_rule";
DROP TABLE IF EXISTS "bank_format";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261102000100_bank_formats_rules';
```

What breaks: remembered bank layouts and operation rules are lost; the next upload of a known bank asks for its mapping again and undecided lines stay undecided. Statements and their records (`import_batch`, `import_record`) are untouched.


## Agent 3: Didox invoices (`202611030*`)

### `20261103000100_didox`

Adds `didox_connection` (per-org Didox token, sealed) and `didox_document` (the raw document JSON and PDF cached per Didox id).

```sql
DROP TABLE IF EXISTS "didox_document";
DROP TABLE IF EXISTS "didox_connection";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261103000100_didox';
```

What breaks: the Didox connection must be set up again and the sync re-fetches every document it already imported only if its batch is also gone (batches keep the Didox id in `externalRef`); invoice batches and records are untouched.


## Agent 4: MXIK intelligence and products (`202611040*`)

### `20261104000100_products_packaging`

Adds `product`, `product_alias`, `packaging_code` (Tasnif packaging cache) and `mxik_code_state` (activity of retired codes from the Tasnif API), with their indexes, the identity unique index and the trigram index on `product.normalizedName`.

```sql
DROP TABLE IF EXISTS "product_alias";
DROP TABLE IF EXISTS "product";
DROP TABLE IF EXISTS "packaging_code";
DROP TABLE IF EXISTS "mxik_code_state";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261104000100_products_packaging';
```

What breaks: the product catalogue of every org is lost (product batches under `import_batch` stay, so it can be rebuilt by saving them again); confirmed MXIK mappings are safe in `firm_mapping`; packaging checks fetch from Tasnif again.

### `20261104000200_product_alternatives`

Adds the nullable `product.mxikAlternatives` JSON column (the runner-up codes of a classification).

```sql
ALTER TABLE "product" DROP COLUMN IF EXISTS "mxikAlternatives";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261104000200_product_alternatives';
```

What breaks: the product drawer shows no alternatives until the next classification. Roll this back before `20261104000100_products_packaging`.


## Agent 5: platform (`202611050*`)

### `20261105000100_default_client_backfill` (Q4, `fix/platform-quality-fixes`)

Adds the default client (`'cl' || md5(orgId)`, named after the org) to every organisation that had
no client at all. Rows only; no schema change.

```sql
-- Optional: only clients the backfill made and that still hold nothing. Usually leave them: the old
-- code created the same row on the first GET /api/shell anyway.
DELETE FROM "client" c
WHERE c."isDefault" AND c."id" = 'cl' || md5(c."orgId")
  AND c."createdAt" >= (SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = '20261105000100_default_client_backfill') - interval '1 minute'
  AND c."createdAt" <= (SELECT finished_at FROM "_prisma_migrations" WHERE migration_name = '20261105000100_default_client_backfill')
  AND NOT EXISTS (SELECT 1 FROM "catalog" k WHERE k."clientId" = c."id")
  AND NOT EXISTS (SELECT 1 FROM "import_batch" b WHERE b."clientId" = c."id");
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261105000100_default_client_backfill';
```

What breaks: nothing in the old code (its shell GET creates the row again). With the new code, an
org without a client shows no active client until its first upload creates the default one.

## Onboarding tour (`202611060*`)

### `20261106000100_user_tour` (T1.1, `feat/onboarding-tour`)

Adds the nullable `user.tourCompletedAt` timestamp: when the user finished or skipped the guided
tour (`PUT /api/account/tour`); null = the tour opens on the next visit. No backfill.

```sql
ALTER TABLE "user" DROP COLUMN IF EXISTS "tourCompletedAt";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261106000100_user_tour';
```

What breaks: with the new code still running, the mark-done call (`PUT /api/account/tour`) answers
500 and `GET /api/shell` reads the unreadable flag as `tour: "done"`, so the tour never opens on its
own (the frame itself keeps working). Deploy the previous code first; it never reads the column.

## Module flags (`202611070*`)

### `20261107000100_feature_flags`

Adds the `feature_flag` table and the `feature_state` enum: the state of each product module the
owner set on `/admin/features` (`PUT /api/admin/features`). No row = `ENABLED`. No seed.

```sql
DROP TABLE IF EXISTS "feature_flag";
DROP TYPE IF EXISTS "feature_state";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261107000100_feature_flags';
```

What breaks: with the new code still running, every request under a module's prefix (API and web)
answers 500 once the cached states expire, and `/admin/features` cannot save. Deploy the previous
code first; it never reads the table.

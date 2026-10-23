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

Filled in Phase C from `feat/onec-integration-core`.

## Agent 2: bank statements (`202611020*`)

Filled in Phase C from `feat/bank-statement-automation`.

## Agent 3: Didox invoices (`202611030*`)

Filled in Phase C from `feat/didox-invoice-automation`.

## Agent 4: MXIK intelligence and products (`202611040*`)

Filled in Phase C from `feat/mxik-product-intelligence`.

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

-- Q4 (Agent 5B): every organisation has its default client from the start. Sign-up (password,
-- Google, Telegram) now creates it with the org; before, the first GET /api/shell created it, so an
-- org driven only through the API had none and the upload wizard refused it ("no right"). This
-- backfills the orgs that still have no client at all, with the same id formula as the clients
-- migration, defaultClient() and the catalogue trigger. Additive (rows only); rerunnable.
-- Rollback: nothing to undo in the schema; see docs/accounting-2026-10-23/migrations.md.
INSERT INTO "client" ("id", "orgId", "name", "isDefault")
SELECT 'cl' || md5(o.id), o.id, o.name, true
FROM "organization" o
WHERE NOT EXISTS (SELECT 1 FROM "client" c WHERE c."orgId" = o.id)
ON CONFLICT ("orgId") WHERE "isDefault" DO NOTHING;
